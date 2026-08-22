/**
 * Un raffineur doit pouvoir exister.
 *
 * La migration 0027 a ajoute le type d'entite `REFINER` et son corridor
 * (origine -> destination), parce qu'un raffineur n'est pas un producteur : il
 * n'extrait pas, il recoit et affine. La base l'admet depuis.
 *
 * `kybSchema`, lui, ne l'a jamais admis : son enumeration est restee
 * `INDIVIDUAL | COOPERATIVE | COMPANY`. Or c'est le SEUL chemin d'ecriture vers
 * `producer_profiles`. Aucun raffineur ne pouvait donc etre cree.
 *
 * LA CONSEQUENCE N'EST PAS COSMETIQUE. Les frais de garde ne facturent que
 * `entity_type = 'REFINER'` (`storage_fee_applies_to`, valeur par defaut). Une
 * colonne que rien ne peut renseigner rendait donc le travail quotidien de
 * facturation silencieusement sans effet : il tournait, ne trouvait personne, et
 * se declarait satisfait.
 *
 * Ces tests tournent sur une VRAIE base : c'est la contrainte `CHECK` sur
 * `entity_type` et la jointure de `holdersToCharge` qui sont en cause, et un
 * mock n'a ni l'une ni l'autre.
 */

import { describe, expect, it } from 'vitest';
import { createTestD1, seedWallet } from '../helpers/real-d1';
import {
  kybSchema,
  ProducerProfileService,
} from '../../src/services/producer-profile.service';
import { StorageFeeService } from '../../src/services/storage-fee.service';

const RAFFINEUR = {
  entityType: 'REFINER' as const,
  legalName: 'Raffinerie du Golfe',
  representativeName: 'A. Diallo',
  corridorOriginCountry: 'BF',
  corridorDestinationCountry: 'AE',
};

function baseAvecTitulaire(id = 'u1') {
  const db = createTestD1();
  db.sqlite
    .prepare("INSERT INTO users (id, email, phone, role) VALUES (?, ?, ?, 'producer')")
    .run(id, `${id}@b.c`, '+22670000000');
  seedWallet(db, { id: `w-${id}`, userId: id, tokens: 500 });
  return db;
}

describe('Le contrat admet un raffineur', () => {
  it('accepte REFINER, que la base admet depuis la migration 0027', () => {
    expect(kybSchema.safeParse(RAFFINEUR).success).toBe(true);
  });

  it('continue d accepter les trois types de la filiere extraction', () => {
    for (const entityType of ['INDIVIDUAL', 'COOPERATIVE', 'COMPANY'] as const) {
      const r = kybSchema.safeParse({
        entityType,
        legalName: 'Cooperative X',
        representativeName: 'A. Diallo',
      });
      expect(r.success, entityType).toBe(true);
    }
  });

  it('refuse toujours un type inconnu', () => {
    expect(kybSchema.safeParse({ ...RAFFINEUR, entityType: 'BANQUE' }).success).toBe(false);
  });

  it('exige le corridor d un raffineur, et de lui seul', () => {
    // Un raffineur sans corridor ne dit pas d'ou vient le metal ni ou il est
    // affine — c'est precisement ce que la migration a ajoute pour lui.
    const sansCorridor = kybSchema.safeParse({
      entityType: 'REFINER',
      legalName: 'Raffinerie du Golfe',
      representativeName: 'A. Diallo',
    });
    expect(sansCorridor.success).toBe(false);

    // Une cooperative n'en a pas : elle extrait, elle ne transporte pas.
    const cooperative = kybSchema.safeParse({
      entityType: 'COOPERATIVE',
      legalName: 'Cooperative X',
      representativeName: 'A. Diallo',
    });
    expect(cooperative.success).toBe(true);
  });
});

describe('Le corridor est ecrit et relu', () => {
  it('conserve origine et destination', async () => {
    const db = baseAvecTitulaire();
    const service = new ProducerProfileService(db as never);

    const profil = await service.submit('u1', kybSchema.parse(RAFFINEUR));

    expect(profil?.entity_type).toBe('REFINER');
    expect(profil?.corridor_origin_country).toBe('BF');
    expect(profil?.corridor_destination_country).toBe('AE');

    const relu = await service.getByUserId('u1');
    expect(relu?.corridor_origin_country).toBe('BF');
    expect(relu?.corridor_destination_country).toBe('AE');
  });

  it('laisse le corridor vide pour une cooperative', async () => {
    const db = baseAvecTitulaire();
    const service = new ProducerProfileService(db as never);

    const profil = await service.submit(
      'u1',
      kybSchema.parse({
        entityType: 'COOPERATIVE',
        legalName: 'Cooperative X',
        representativeName: 'A. Diallo',
      })
    );

    expect(profil?.corridor_origin_country).toBeNull();
    expect(profil?.corridor_destination_country).toBeNull();
  });
});

describe('Les frais de garde trouvent enfin quelqu un a facturer', () => {
  it('facture un raffineur qui detient de l or', async () => {
    const db = baseAvecTitulaire();
    await new ProducerProfileService(db as never).submit('u1', kybSchema.parse(RAFFINEUR));

    const detenteurs = await new StorageFeeService(db as never).holdersToCharge('2026-08-22');

    // Avant : la liste etait vide quoi qu'il arrive, faute de raffineur possible.
    expect(detenteurs).toHaveLength(1);
    expect(detenteurs[0].user_id).toBe('u1');
    expect(detenteurs[0].stored_g).toBe(500);
  });

  it('ne facture pas une cooperative, qui n est pas dans le perimetre', async () => {
    const db = baseAvecTitulaire();
    await new ProducerProfileService(db as never).submit(
      'u1',
      kybSchema.parse({
        entityType: 'COOPERATIVE',
        legalName: 'Cooperative X',
        representativeName: 'A. Diallo',
      })
    );

    const detenteurs = await new StorageFeeService(db as never).holdersToCharge('2026-08-22');
    expect(detenteurs).toHaveLength(0);
  });

  it('facture tout le monde quand le perimetre est ALL', async () => {
    const db = baseAvecTitulaire();
    // Aucun profil : un simple investisseur.
    const detenteurs = await new StorageFeeService(db as never).holdersToCharge(
      '2026-08-22',
      'ALL'
    );
    expect(detenteurs).toHaveLength(1);
  });
});
