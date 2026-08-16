/**
 * Portail État — le module qui n'avait aucun test.
 *
 * Ce qui est vérifié ici n'est pas que les écrans s'affichent, mais les trois
 * propriétés sur lesquelles repose l'argument fait à l'État :
 *
 *  1. Le portail est en **lecture seule**. Aucune route ne modifie quoi que ce
 *     soit hors de l'authentification.
 *  2. Il est **cloisonné**. Un jeton client ou back-office n'y entre pas, même
 *     si l'adresse correspond à un compte existant.
 *  3. Il ne livre **aucune identité**. L'État voit des agrégats et des
 *     références de lot, jamais qui détient quoi.
 *
 * Les deux premières ont déjà été enfreintes une fois dans ce dépôt — un jeton
 * client ouvrait `/admin/*`. La troisième l'était encore quand ces tests ont
 * été écrits : l'export CSV livrait l'adresse e-mail de chaque détenteur.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { stateRoutes } from '../../src/routes/state';
import { AuthService } from '../../src/services/auth.service';
import type { AppEnv } from '../../src/types/env';
import { createMockD1Database, createMockEnv } from '../setup';
import { canAccessStatePortal, canAccessAdminPortal, isPortalToken } from '../../src/lib/portal';

const JWT_SECRET = 'test-secret-at-least-32-characters-long!!';

/** Le module lu tel qu'il est écrit. */
const SOURCE = readFileSync(new URL('../../src/routes/state.ts', import.meta.url), 'utf8');
/**
 * Le corps du module après le bloc d'authentification : celui-ci manipule
 * légitimement l'adresse de l'opérateur État lui-même.
 */
const VIEWS = SOURCE.slice(SOURCE.indexOf('GET /state/dashboard'));

function declaredRoutes(app: Hono<AppEnv>) {
  return app.routes
    .filter((r) => r.method !== 'ALL')
    .map((r) => ({ method: r.method, path: r.path }));
}

describe('Portail État', () => {
  let app: Hono<AppEnv>;
  let mockEnv: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = createMockEnv();
    (mockEnv as Record<string, unknown>).JWT_SECRET = JWT_SECRET;

    app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      if (!c.env) (c as unknown as { env: Record<string, unknown> }).env = {};
      for (const [key, value] of Object.entries(mockEnv)) {
        (c.env as Record<string, unknown>)[key] = value;
      }
      return next();
    });
    app.route('/state', stateRoutes);
  });

  describe('lecture seule', () => {
    it("n'expose aucune route d'écriture en dehors de l'authentification", () => {
      // C'est l'argument fait à l'État : le portail ne peut rien modifier. S'il
      // fallait un jour y ajouter une écriture, ce test doit obliger à en
      // discuter plutôt que de la laisser passer.
      const AUTH_ONLY = ['/state/login', '/state/2fa/setup', '/state/2fa/verify', '/state/logout'];

      const writes = declaredRoutes(app).filter(
        (r) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(r.method) && !AUTH_ONLY.includes(r.path)
      );

      expect(writes, `écritures inattendues : ${JSON.stringify(writes)}`).toEqual([]);
    });

    it('déclare bien les lectures attendues', () => {
      const gets = declaredRoutes(app)
        .filter((r) => r.method === 'GET')
        .map((r) => r.path);

      for (const path of ['/state/dashboard', '/state/stock', '/state/reports/por']) {
        expect(gets, path).toContain(path);
      }
    });
  });

  describe('cloisonnement des portails', () => {
    async function tokenFor(portal: string | undefined, email = 'etat@example.bf') {
      // Le jeton est signé avec le MÊME secret que les autres portails : c'est
      // précisément ce qui rend le cloisonnement nécessaire.
      const auth = new AuthService(JWT_SECRET);
      // `sub` doit être un UUID et `kycLevel` une valeur connue : le schéma Zod
      // de vérification rejette tout le reste, ce qui donnerait un 401 au lieu
      // du 403 que ces tests cherchent à observer.
      const tokens = await auth.generateTokens({
        sub: '11111111-1111-4111-8111-111111111111',
        email,
        kycLevel: 'VERIFIED',
        ...(portal ? { portal } : {}),
      } as never);
      return tokens.accessToken;
    }

    const call = (path: string, token?: string) =>
      app.request(`/state${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

    it('refuse une requête sans jeton', async () => {
      const res = await call('/dashboard');
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('STATE_AUTH_REQUIRED');
    });

    it('refuse un jeton du portail admin', async () => {
      // Un opérateur back-office ne voit pas le portail État, et réciproquement.
      const res = await call('/dashboard', await tokenFor('admin'));
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        'STATE_ACCESS_DENIED'
      );
    });

    it("refuse un jeton client, même si l'adresse correspond à un compte", async () => {
      // Le défaut déjà rencontré dans ce dépôt : identifier l'appelant par son
      // email seul laissait entrer un jeton obtenu par la connexion ordinaire,
      // qui n'impose pas le TOTP.
      const res = await call('/dashboard', await tokenFor(undefined));
      expect(res.status).toBe(403);
    });

    it('refuse un jeton illisible', async () => {
      const res = await call('/dashboard', 'pas-un-jwt');
      expect([401, 403]).toContain(res.status);
    });

    it("refuse un porteur du bon portail qui n'est pas opérateur État", async () => {
      // Le jeton porte `state`, mais aucune ligne active en base : le rôle est
      // revérifié à chaque requête, pas seulement à la connexion.
      mockEnv.DB = createMockD1Database({ first: null }) as never;
      const res = await call('/dashboard', await tokenFor('state'));
      expect(res.status).toBe(403);
    });
  });

  describe('rôles', () => {
    it('sépare le portail État du back-office', () => {
      // STATE_OPERATOR est délibérément absent des rôles back-office : l'État
      // voit des agrégats, pas les utilisateurs individuels.
      expect(canAccessStatePortal('STATE_OPERATOR')).toBe(true);
      expect(canAccessAdminPortal('STATE_OPERATOR')).toBe(false);

      for (const role of ['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'SUPPORT']) {
        expect(canAccessStatePortal(role), role).toBe(false);
      }
    });

    it("n'accepte un jeton que pour le portail qui l'a émis", () => {
      expect(isPortalToken({ portal: 'state' }, 'state')).toBe(true);
      expect(isPortalToken({ portal: 'admin' }, 'state')).toBe(false);
      // Un jeton sans portail est un jeton client : jamais privilégié.
      expect(isPortalToken({}, 'state')).toBe(false);
      expect(isPortalToken(null, 'state')).toBe(false);
    });
  });

  describe('confidentialité', () => {
    // Ces propriétés portent sur ce que le code PEUT renvoyer. Les vérifier sur
    // une réponse simulée passerait à côté d'une colonne ajoutée plus tard.

    it("n'extrait aucune colonne identifiante de la table des utilisateurs", () => {
      // Compter des utilisateurs est un agrégat, légitime pour un tableau de
      // bord d'État. Sélectionner leur email, leur téléphone ou leur nom ne
      // l'est pas : cela transforme un portail statistique en fichier nominatif
      // de qui détient de l'or dans le pays.
      const identifying = VIEWS.split('\n').filter((line) =>
        /\bu\.(email|phone|first_name|last_name|password)/i.test(line)
      );

      expect(identifying, `colonnes identifiantes : ${identifying.join(' | ')}`).toEqual([]);
    });

    it("n'exporte qu'une référence pseudonyme du détenteur", () => {
      // L'export CSV livrait `u.email as user_email` pour chaque transaction —
      // jusqu'à 100 000 lignes nominatives. La référence qui l'a remplacé
      // permet de regrouper un détenteur sans le désigner.
      expect(VIEWS).not.toContain('user_email');
      expect(VIEWS).toContain('holder_ref');
    });

    it("ne renvoie aucun numéro de téléphone", () => {
      expect(/\bphone\b/i.test(VIEWS)).toBe(false);
    });

    it('ne consulte la table des utilisateurs que pour des agrégats', () => {
      // Toute lecture de `users` doit être un COUNT, un SUM ou la jointure de
      // l'export — jamais une liste d'utilisateurs.
      const reads = VIEWS.split('\n').filter((line) => /\b(FROM|JOIN)\s+users\b/i.test(line));
      expect(reads.length).toBeGreaterThan(0); // sinon le test ne prouve rien

      for (const line of reads) {
        const isAggregate = /COUNT\s*\(|SUM\s*\(/i.test(line);
        const isExportJoin = /JOIN\s+users\s+u\s+ON/i.test(line);
        const context = VIEWS.slice(Math.max(0, VIEWS.indexOf(line) - 400), VIEWS.indexOf(line));
        expect(
          isAggregate || isExportJoin || /COUNT\s*\(|SUM\s*\(/i.test(context),
          `lecture non agrégée : ${line.trim()}`
        ).toBe(true);
      }
    });
  });
});
