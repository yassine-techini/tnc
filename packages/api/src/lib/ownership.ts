/**
 * Appartenance d'une ressource — la forme canonique.
 *
 * Une garde de route (`requirePermission`) repond a « cet appelant a-t-il ce
 * droit ? ». Elle ne dit rien sur « CETTE ressource est-elle la sienne ? ». Sans
 * ce second controle, n'importe quel titulaire de compte lit ou modifie les
 * donnees d'un autre en changeant un identifiant dans l'URL.
 *
 * Le sixieme audit a trouve les dix-sept routes concernees correctement gardees
 * — mais par QUATRE idiomes differents : filtre SQL, comparaison sur `user_id`,
 * comparaison sur `producer_id`, delegation a un service. Quatre facons d'ecrire
 * une meme regle, c'est une regle qu'on applique de memoire. Ce module lui donne
 * une forme, et `scripts/check-route-ownership.mjs` refuse une route a parametre
 * qui n'en porte aucune.
 */

/** Ce qu'une ressource doit exposer pour qu'on puisse en verifier le porteur. */
export type RessourcePossedee =
  | { user_id: string | null | undefined }
  | { producer_id: string | null | undefined }
  | { owner_id: string | null | undefined };

function porteur(ressource: RessourcePossedee): string | null | undefined {
  const r = ressource as Record<string, string | null | undefined>;
  return r.user_id ?? r.producer_id ?? r.owner_id;
}

/**
 * Vrai quand la ressource existe ET appartient a l'appelant.
 *
 * Une ressource absente et une ressource etrangere rendent la MEME reponse :
 * repondre 403 sur l'une et 404 sur l'autre revient a confirmer l'existence de
 * ce qu'on refuse de montrer, et transforme la route en oracle qui enumere les
 * identifiants.
 */
export function appartientA(
  ressource: RessourcePossedee | null | undefined,
  userId: string | null | undefined
): boolean {
  if (!ressource || !userId) return false;
  const proprietaire = porteur(ressource);
  return Boolean(proprietaire) && proprietaire === userId;
}

/**
 * Forme d'echec commune : `null` quand tout va bien, sinon le corps a renvoyer
 * avec un 404.
 *
 * On renvoie une valeur plutot que de lever : les routes de ce depot repondent
 * par `c.json(...)`, et une exception traverserait le gestionnaire d'erreurs
 * generique qui, lui, produirait un 500 — donc un message qui n'aide personne.
 */
export function refusSiEtranger(
  ressource: RessourcePossedee | null | undefined,
  userId: string | null | undefined,
  /**
   * REQUIS depuis l'ADR 025 : ce helper n'a pas de contexte de requete, donc
   * pas de langue. Un defaut ecrit ici serait du francais fige que rien ne
   * traduirait. L'appelant passe `texte(c, 'NOT_FOUND', { ressource: … })`.
   */
  libelle: string
): { success: false; error: { code: 'NOT_FOUND'; message: string } } | null {
  if (appartientA(ressource, userId)) return null;
  return { success: false, error: { code: 'NOT_FOUND', message: libelle } };
}
