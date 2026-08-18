import { describe, expect, it } from 'vitest';
import { chiffresReserve } from '../../src/lib/reserve';

/**
 * Le vocabulaire de la reserve — ADR 012.
 *
 * Cinq routes Etat et deux routes admin derivaient « jetons emis » de la somme
 * des portefeuilles. La location sortant les grammes du portefeuille, cette
 * somme vaut `tokens_issued - gold_on_loan` : le portail annoncait au ministere
 * une couverture surevaluee de tout l'or en location.
 *
 * Ces tests figent les grandeurs, leurs noms, et les deux definitions qui se
 * contredisaient.
 */

/** Le scenario de l'ADR : 1000 g alloues, 900 g emis, 400 g en location. */
const AVEC_LOCATION = { total_allocated: 1000, tokens_issued: 900, gold_on_loan: 400 };

describe('Les jetons emis', () => {
  it('valent tokens_issued, pas la somme des portefeuilles', () => {
    const r = chiffresReserve(AVEC_LOCATION);

    // La somme des portefeuilles vaudrait 500 (900 - 400) : c'est ce chiffre
    // que le portail affichait sous « Tokens Emis ».
    expect(r.emisG).toBe(900);
  });

  it('ne bougent pas quand de l or part en location', () => {
    const avant = chiffresReserve({ total_allocated: 1000, tokens_issued: 900, gold_on_loan: 0 });
    const apres = chiffresReserve(AVEC_LOCATION);

    // Louer ne detruit pas un jeton : il change seulement de place.
    expect(apres.emisG).toBe(avant.emisG);
  });
});

describe('Le disponible', () => {
  it('est alloue moins emis, pas alloue moins portefeuilles', () => {
    // Le portail affichait 500 g (1000 - 500). Il en reste 100.
    expect(chiffresReserve(AVEC_LOCATION).disponibleG).toBe(100);
  });
});

describe('La couverture', () => {
  it('est alloue / emis, et 1 ou plus est sain', () => {
    // Le portail affichait 2.00 (1000/500). La verite est 1.11.
    expect(chiffresReserve(AVEC_LOCATION).couverture).toBe(1.11);
  });

  it('n est pas un nombre quand rien n est emis', () => {
    // `Infinity` etait renvoye, et `JSON.stringify` le rendait `null` : le
    // contrat annoncait `number` et la route livrait `null`.
    const r = chiffresReserve({ total_allocated: 1000, tokens_issued: 0, gold_on_loan: 0 });

    expect(r.couverture).toBeNull();
  });

  it('est bien l inverse de l utilisation', () => {
    const r = chiffresReserve({ total_allocated: 1000, tokens_issued: 500, gold_on_loan: 0 });

    // Les confondre inversait la lecture : c'est exactement ce que faisait le
    // back-office, qui testait `coverage >= 1` sur un taux d'utilisation.
    expect(r.couverture).toBe(2);
    expect(r.utilisation).toBe(0.5);
  });

  it('rend une utilisation sous 1 tant qu il reste du disponible', () => {
    // Le voyant du back-office ne passait au vert qu a utilisation = 1,
    // c est-a-dire quand il ne restait plus un gramme.
    const r = chiffresReserve(AVEC_LOCATION);

    expect(r.utilisation).toBeLessThan(1);
    expect(r.disponibleG).toBeGreaterThan(0);
  });
});

describe('L or en coffre', () => {
  it('est l alloue moins le prete', () => {
    expect(chiffresReserve(AVEC_LOCATION).enCoffreG).toBe(600);
  });

  it('ne descend pas sous zero', () => {
    const r = chiffresReserve({ total_allocated: 100, tokens_issued: 0, gold_on_loan: 400 });

    expect(r.enCoffreG).toBe(0);
  });
});

describe('« Entierement en coffre »', () => {
  it('suit la definition de l attestation, pas « rien n est prete »', () => {
    // 1000 alloues, 900 emis, 50 pretes : le coffre en contient 950, donc les
    // 900 emis sont couverts. L attestation SIGNEE repondait oui et le tableau
    // de bord affichait l alerte rouge, le meme jour.
    const r = chiffresReserve({ total_allocated: 1000, tokens_issued: 900, gold_on_loan: 50 });

    expect(r.entierementEnCoffre).toBe(true);
    expect(r.preteG).toBe(50); // « rien n est prete » reste lisible ailleurs
  });

  it('devient faux quand le coffre ne couvre plus les jetons emis', () => {
    expect(chiffresReserve(AVEC_LOCATION).entierementEnCoffre).toBe(false);
  });
});

describe('Les bords', () => {
  it('rend des zeros quand le stock est absent', () => {
    const r = chiffresReserve(null);

    expect(r.alloueG).toBe(0);
    expect(r.emisG).toBe(0);
    expect(r.couverture).toBeNull();
    expect(r.utilisation).toBeNull();
  });

  it('traite un gold_on_loan nul comme zero', () => {
    const r = chiffresReserve({ total_allocated: 100, tokens_issued: 10, gold_on_loan: null });

    expect(r.preteG).toBe(0);
    expect(r.enCoffreG).toBe(100);
  });

  it('tient l invariant a l egalite', () => {
    const r = chiffresReserve({ total_allocated: 900, tokens_issued: 900, gold_on_loan: 0 });

    expect(r.invariantTenu).toBe(true);
    expect(r.disponibleG).toBe(0);
  });
});
