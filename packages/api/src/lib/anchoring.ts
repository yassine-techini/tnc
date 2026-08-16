/**
 * On-chain anchoring of reserve attestation digests — ADR 003.
 *
 * Anchoring writes 32 bytes in a way that is timestamped and cannot be
 * rewritten. That needs no smart contract: a zero-value self-transfer carrying
 * the digest in calldata is immutable, readable by anyone, and costs the
 * minimum. Deploying a contract would have added the heaviest risk ADR 002
 * identified — an upgradable proxy admin becoming the platform's most critical
 * secret — for a use case with no on-chain logic at all.
 *
 * What this proves, and what it does not: that a digest EXISTED at a given time
 * and has not changed since. Not that the gold exists, nor that the attestation
 * is true. Truth rests on the Dubai audit and the lots referenced in the
 * payload.
 */

export interface AnchorResult {
  ok: boolean;
  chain: string | null;
  txHash: string | null;
  error: string | null;
}

export interface AnchorAdapter {
  /** Human-readable chain identifier stored alongside the transaction hash. */
  readonly chain: string;
  /** Whether this adapter can actually submit right now. */
  isAvailable(): Promise<boolean>;
  /** Submit a digest. Must not throw — failures come back as AnchorResult. */
  anchor(digest: string): Promise<AnchorResult>;
  /** Public explorer URL for a transaction, for the /reserve page. */
  explorerUrl(txHash: string): string;
}

export interface AnchorConfig {
  /** Chain key, e.g. 'base-sepolia'. Testnet by default — see ADR 003. */
  chain?: string;
  rpcUrl?: string;
  /** secp256k1 key of the anchoring wallet. NEVER the attestation signing key. */
  privateKey?: string;
}

/** Known chains. Testnets first: a misconfigured deployment must not spend real funds. */
export const CHAINS: Record<string, { id: number; name: string; explorer: string; testnet: boolean }> = {
  'base-sepolia': { id: 84532, name: 'Base Sepolia', explorer: 'https://sepolia.basescan.org/tx/', testnet: true },
  'polygon-amoy': { id: 80002, name: 'Polygon Amoy', explorer: 'https://amoy.polygonscan.com/tx/', testnet: true },
  base: { id: 8453, name: 'Base', explorer: 'https://basescan.org/tx/', testnet: false },
  polygon: { id: 137, name: 'Polygon', explorer: 'https://polygonscan.com/tx/', testnet: false },
};

export const DEFAULT_CHAIN = 'base-sepolia';

/**
 * Encode a digest as transaction calldata.
 *
 * A short magic prefix makes an anchoring transaction identifiable among a
 * wallet's history without any off-chain index: "TNCPOR1" then the 32 bytes.
 */
export const ANCHOR_MAGIC = '544e43504f5231'; // "TNCPOR1" in hex

export function encodeAnchorCalldata(digest: string): string {
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error('encodeAnchorCalldata: digest must be 64 lowercase hex characters');
  }
  return `0x${ANCHOR_MAGIC}${digest}`;
}

/** Recover the digest from calldata, which is what an external verifier does. */
export function decodeAnchorCalldata(calldata: string): string | null {
  const hex = calldata.startsWith('0x') ? calldata.slice(2) : calldata;
  if (!hex.toLowerCase().startsWith(ANCHOR_MAGIC)) return null;
  const digest = hex.slice(ANCHOR_MAGIC.length).toLowerCase();
  return /^[0-9a-f]{64}$/.test(digest) ? digest : null;
}

/**
 * Adapter used when anchoring is not configured. Attestations remain published
 * and verifiable; only the extra on-chain confirmation is absent.
 */
export class NullAnchorAdapter implements AnchorAdapter {
  readonly chain = 'none';
  async isAvailable(): Promise<boolean> {
    return false;
  }
  async anchor(_digest: string): Promise<AnchorResult> {
    return { ok: false, chain: null, txHash: null, error: 'Ancrage non configuré' };
  }
  explorerUrl(): string {
    return '';
  }
}

/**
 * EVM adapter: a zero-value self-transfer carrying the digest in calldata.
 *
 * `viem` is imported lazily. Building and signing an EVM transaction needs
 * keccak256, RLP and secp256k1, and WebCrypto provides none of them — but a
 * deployment that does not anchor should not have to carry the dependency, nor
 * break because it is absent. Missing library or missing configuration both
 * degrade to "unavailable", never to a crash.
 */
export class EvmAnchorAdapter implements AnchorAdapter {
  readonly chain: string;

  constructor(private config: AnchorConfig) {
    this.chain = config.chain || DEFAULT_CHAIN;
  }

  private chainSpec() {
    return CHAINS[this.chain];
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.chainSpec() && this.config.rpcUrl && this.config.privateKey);
  }

  explorerUrl(txHash: string): string {
    const spec = this.chainSpec();
    return spec ? `${spec.explorer}${txHash}` : '';
  }

  async anchor(digest: string): Promise<AnchorResult> {
    const spec = this.chainSpec();
    if (!spec) {
      return { ok: false, chain: this.chain, txHash: null, error: `Chaîne inconnue : ${this.chain}` };
    }
    if (!(await this.isAvailable())) {
      return { ok: false, chain: this.chain, txHash: null, error: 'RPC ou clé d\'ancrage absents' };
    }

    let calldata: string;
    try {
      calldata = encodeAnchorCalldata(digest);
    } catch (error) {
      return { ok: false, chain: this.chain, txHash: null, error: String(error) };
    }

    try {
      // Lazy AND indirect: the specifier is a variable so TypeScript does not
      // resolve it at build time. A deployment that never anchors should not
      // have to carry the dependency, nor fail to compile without it.
      const viemModule = 'viem';
      const accountsModule = 'viem/accounts';
      const viem: Record<string, unknown> | null = await import(/* @vite-ignore */ viemModule)
        .then((m): Record<string, unknown> => m as Record<string, unknown>)
        .catch((): null => null);
      const accounts: Record<string, unknown> | null = await import(/* @vite-ignore */ accountsModule)
        .then((m): Record<string, unknown> => m as Record<string, unknown>)
        .catch((): null => null);
      if (!viem || !accounts) {
        return {
          ok: false,
          chain: this.chain,
          txHash: null,
          error: 'Dépendance viem absente — exécuter pnpm install',
        };
      }

      const privateKeyToAccount = accounts.privateKeyToAccount as (k: string) => { address: string };
      const createWalletClient = viem.createWalletClient as (o: unknown) => {
        sendTransaction: (tx: unknown) => Promise<string>;
      };
      const http = viem.http as (u: string) => unknown;

      const account = privateKeyToAccount(this.config.privateKey as string);
      const client = createWalletClient({
        account,
        transport: http(this.config.rpcUrl as string),
        chain: { id: spec.id, name: spec.name, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [this.config.rpcUrl as string] } } },
      });

      const txHash = await client.sendTransaction({
        to: account.address,
        value: 0n,
        data: calldata,
      });

      return { ok: true, chain: this.chain, txHash, error: null };
    } catch (error) {
      return { ok: false, chain: this.chain, txHash: null, error: String(error) };
    }
  }
}

/**
 * Build the adapter for this deployment. Returns the null adapter when nothing
 * is configured, so callers never have to special-case absence.
 */
export function createAnchorAdapter(config: AnchorConfig): AnchorAdapter {
  if (!config.rpcUrl || !config.privateKey) return new NullAnchorAdapter();
  return new EvmAnchorAdapter(config);
}

/** Whether a chain key designates a mainnet — used to require an explicit opt-in. */
export function isMainnet(chain: string): boolean {
  return CHAINS[chain] ? !CHAINS[chain].testnet : false;
}
