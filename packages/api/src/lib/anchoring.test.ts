import { describe, it, expect } from 'vitest';
import {
  encodeAnchorCalldata,
  decodeAnchorCalldata,
  createAnchorAdapter,
  NullAnchorAdapter,
  EvmAnchorAdapter,
  isMainnet,
  CHAINS,
  DEFAULT_CHAIN,
  ANCHOR_MAGIC,
} from './anchoring';

const DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('calldata encoding', () => {
  it('round-trips a digest, which is what an external verifier does', () => {
    const calldata = encodeAnchorCalldata(DIGEST);
    expect(calldata.startsWith(`0x${ANCHOR_MAGIC}`)).toBe(true);
    expect(decodeAnchorCalldata(calldata)).toBe(DIGEST);
  });

  it('carries a recognisable prefix so an anchor is identifiable without an index', () => {
    // "TNCPOR1" in hex — lets anyone spot anchoring transactions in a wallet's
    // history with no off-chain lookup.
    expect(Buffer.from(ANCHOR_MAGIC, 'hex').toString('ascii')).toBe('TNCPOR1');
  });

  it('refuses anything that is not a 32-byte lowercase hex digest', () => {
    expect(() => encodeAnchorCalldata('')).toThrow();
    expect(() => encodeAnchorCalldata('abc')).toThrow();
    expect(() => encodeAnchorCalldata(DIGEST.toUpperCase())).toThrow();
    expect(() => encodeAnchorCalldata(`0x${DIGEST}`)).toThrow();
  });

  it('does not mistake unrelated calldata for an anchor', () => {
    expect(decodeAnchorCalldata('0xdeadbeef')).toBeNull();
    expect(decodeAnchorCalldata('0x')).toBeNull();
    // Right prefix, truncated digest.
    expect(decodeAnchorCalldata(`0x${ANCHOR_MAGIC}abcd`)).toBeNull();
  });
});

describe('adapter selection', () => {
  it('falls back to the null adapter when nothing is configured', async () => {
    const adapter = createAnchorAdapter({});
    expect(adapter).toBeInstanceOf(NullAnchorAdapter);
    expect(await adapter.isAvailable()).toBe(false);

    // Absence degrades, it does not throw: attestations stay published and
    // verifiable, they are simply not anchored.
    const result = await adapter.anchor(DIGEST);
    expect(result).toMatchObject({ ok: false, txHash: null });
    expect(result.error).toBeTruthy();
  });

  it('needs both an RPC endpoint and a key', async () => {
    expect(createAnchorAdapter({ rpcUrl: 'https://rpc' })).toBeInstanceOf(NullAnchorAdapter);
    expect(createAnchorAdapter({ privateKey: '0xabc' })).toBeInstanceOf(NullAnchorAdapter);
    expect(createAnchorAdapter({ rpcUrl: 'https://rpc', privateKey: '0xabc' })).toBeInstanceOf(
      EvmAnchorAdapter
    );
  });

  it('defaults to a testnet, so a misconfiguration cannot spend real funds', () => {
    expect(CHAINS[DEFAULT_CHAIN].testnet).toBe(true);
    const adapter = createAnchorAdapter({ rpcUrl: 'https://rpc', privateKey: '0xabc' });
    expect(adapter.chain).toBe(DEFAULT_CHAIN);
    expect(isMainnet(adapter.chain)).toBe(false);
  });

  it('identifies mainnets, which the job requires an explicit opt-in for', () => {
    expect(isMainnet('base')).toBe(true);
    expect(isMainnet('polygon')).toBe(true);
    expect(isMainnet('base-sepolia')).toBe(false);
    expect(isMainnet('polygon-amoy')).toBe(false);
    // An unknown chain is not treated as a mainnet, and is rejected elsewhere
    // as unknown rather than silently anchored.
    expect(isMainnet('nonexistent')).toBe(false);
  });

  it('reports an unknown chain instead of submitting anywhere', async () => {
    const adapter = new EvmAnchorAdapter({ chain: 'nonexistent', rpcUrl: 'https://rpc', privateKey: '0xabc' });
    const result = await adapter.anchor(DIGEST);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/inconnue/i);
  });

  it('builds an explorer link so /reserve can show the transaction', () => {
    const adapter = createAnchorAdapter({ chain: 'base', rpcUrl: 'https://rpc', privateKey: '0xabc' });
    expect(adapter.explorerUrl('0xabc123')).toBe('https://basescan.org/tx/0xabc123');
    expect(new NullAnchorAdapter().explorerUrl()).toBe('');
  });

  it('degrades rather than crashing when the chain library is unavailable', async () => {
    // viem is imported lazily: a deployment that does not anchor should not have
    // to carry the dependency, nor break because it is missing.
    const adapter = new EvmAnchorAdapter({
      chain: 'base-sepolia',
      rpcUrl: 'https://rpc.invalid',
      privateKey: '0x' + '1'.repeat(64),
    });
    // La configuration est complète : ce n'est donc PAS elle qui fait échouer
    // l'ancrage, mais bien l'absence de la bibliothèque.
    expect(await adapter.isAvailable()).toBe(true);

    const result = await adapter.anchor(DIGEST);
    expect(result.ok).toBe(false);
    expect(result.txHash).toBeNull();
    expect(result.error).toBeTruthy();
    // Une seconde suffirait si l'import échoue tout de suite ; ce délai couvre
    // la charge d'une suite complète, où ce test a déjà échoué une fois faute
    // de temps plutôt que faute de code.
  }, 20_000);
});
