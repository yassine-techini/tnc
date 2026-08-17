/**
 * Le garde-fou des parcours bout-en-bout, plus le depot reel.
 *
 * Les parcours eux-memes ne s'executent que sur un appareil. Ce qui se verifie
 * partout — y compris ici, sans emulateur — c'est qu'ils designent des elements
 * existants. Le depot reel est controle dans le dernier bloc, pour que la suite
 * de tests attrape un renommage de testID sans qu'il faille penser a lancer le
 * script.
 */
import { describe, expect, it } from 'vitest';
import {
  testIdsDuSource,
  utilisationsDuParcours,
  verifier,
  verifierLeDepot,
} from './check-e2e-selectors.mjs';

describe('testIdsDuSource', () => {
  it('lit les trois formes posees sur un composant', () => {
    const ids = testIdsDuSource(`
      <TextInput testID="marche-montant" />
      <View testID={'bloc-devis'} />
      tabBarButtonTestID: 'onglet-marche',
    `);

    expect([...ids].sort()).toEqual(['bloc-devis', 'marche-montant', 'onglet-marche']);
  });

  it('lit les tables d identifiants ecrites en entier', () => {
    const ids = testIdsDuSource(`
      const TEST_ID: Record<MessageType, string> = {
        error: 'message-erreur',
        success: 'message-succes',
      };
    `);

    expect(ids.has('message-erreur')).toBe(true);
    expect(ids.has('message-succes')).toBe(true);
  });

  it('ignore un identifiant assemble a l execution', () => {
    // Un testID interpole est introuvable statiquement. Le refuser ici force a
    // l'ecrire en entier plutot qu'a rendre le controle inoperant en silence.
    const ids = testIdsDuSource('<View testID={`message-${type}`} />');

    expect(ids.size).toBe(0);
  });
});

describe('utilisationsDuParcours', () => {
  it('releve les selecteurs et les sous-parcours', () => {
    const usages = utilisationsDuParcours(
      ['- runFlow: sous-parcours/connexion.yaml', '- tapOn:', "    id: 'marche-valider'"].join('\n')
    );

    expect(usages).toMatchObject([
      { type: 'runFlow', valeur: 'sous-parcours/connexion.yaml', ligne: 1 },
      { type: 'id', valeur: 'marche-valider', ligne: 3 },
    ]);
  });

  it('ignore les lignes commentees', () => {
    expect(utilisationsDuParcours("#    id: 'ancien-identifiant'")).toEqual([]);
  });
});

describe('verifier', () => {
  const ids = new Set(['marche-valider', 'message-succes']);
  const sousParcours = new Set(['sous-parcours/connexion.yaml']);

  it('accepte ce qui existe', () => {
    const usages = utilisationsDuParcours("    id: 'marche-valider'");

    expect(verifier(usages, ids, sousParcours)).toEqual([]);
  });

  it('refuse un testID que rien ne porte', () => {
    const usages = utilisationsDuParcours("    id: 'marche-confirmer'");

    expect(verifier(usages, ids, sousParcours)).toHaveLength(1);
    expect(verifier(usages, ids, sousParcours)[0].message).toContain('marche-confirmer');
  });

  it('refuse un sous-parcours absent', () => {
    const usages = utilisationsDuParcours('- runFlow: sous-parcours/login.yaml');

    expect(verifier(usages, ids, sousParcours)[0].message).toContain('introuvable');
  });

  it('accepte un identifiant derive quand sa racine existe', () => {
    // InlineMessage pose `message-succes` et `message-succes-texte` ensemble.
    const usages = utilisationsDuParcours("    id: 'message-succes-texte'");

    expect(verifier(usages, ids, sousParcours)).toEqual([]);
  });
});

describe('Le depot reel', () => {
  const resultat = verifierLeDepot();

  it('ne contient aucun parcours designant un element inexistant', () => {
    expect(resultat.problemes).toEqual([]);
  });

  it('couvre effectivement des parcours', () => {
    // Sans ce controle, supprimer tous les fichiers de parcours ferait passer le
    // test precedent avec zero probleme — un vert qui ne verifie rien.
    expect(resultat.utilisations.filter((u) => u.type === 'id').length).toBeGreaterThan(20);
  });
});
