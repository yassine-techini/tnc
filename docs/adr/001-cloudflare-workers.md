# ADR 001: Choix de Cloudflare Workers comme Runtime Backend

## Statut

Accepté

## Contexte

Nous devions choisir une plateforme pour héberger l'API backend de TNC Trading. Les critères principaux étaient :

1. **Latence faible** pour les utilisateurs en Afrique de l'Ouest
2. **Haute disponibilité** (99.9%+)
3. **Scaling automatique** sans gestion de serveurs
4. **Coût maîtrisé** avec facturation à l'usage
5. **Écosystème intégré** (base de données, cache, stockage)

### Options Considérées

1. **AWS Lambda + API Gateway**
   - Avantages : Écosystème mature, nombreuses régions
   - Inconvénients : Cold starts, complexité réseau, coût des régions africaines

2. **Google Cloud Run**
   - Avantages : Container-based, scaling rapide
   - Inconvénients : Pas de région en Afrique, latence élevée

3. **Cloudflare Workers**
   - Avantages : Edge global (200+ PoPs), 0ms cold start, D1/KV/R2 intégrés
   - Inconvénients : Limites CPU (50ms par requête), écosystème plus jeune

4. **VPS classique (DigitalOcean, Hetzner)**
   - Avantages : Contrôle total, coût prévisible
   - Inconvénients : Gestion infrastructure, scaling manuel

## Décision

Nous avons choisi **Cloudflare Workers** avec son écosystème (D1, KV, R2, Queues, Durable Objects).

## Justification

### Performance Edge
- Cloudflare a des PoPs en Afrique (Lagos, Johannesburg, Le Cap, Nairobi)
- Latence < 50ms pour les utilisateurs au Burkina Faso
- Pas de cold start (contrairement à Lambda)

### Simplicité Opérationnelle
- Pas de serveurs à gérer
- Déploiement en < 30 secondes
- Scaling automatique illimité

### Écosystème Intégré
- **D1** : Base de données SQLite distribuée
- **KV** : Cache key-value global
- **R2** : Stockage objets (compatible S3)
- **Queues** : Jobs asynchrones
- **Durable Objects** : État temps réel

### Coût
- Gratuit jusqu'à 100k requêtes/jour
- Puis ~$0.50 par million de requêtes
- Très compétitif vs AWS Lambda

## Conséquences

### Positives
- Latence excellente pour les utilisateurs africains
- Pas de gestion infrastructure
- Coût prévisible et faible
- Intégration native avec Cloudflare (CDN, WAF, DDoS)

### Négatives
- Limite CPU de 50ms par requête (suffisant pour notre cas)
- Écosystème moins mature que AWS
- Dépendance à un seul fournisseur
- Pas de support pour certains packages Node.js natifs

### Mitigations
- Limites CPU : Optimisation du code, utilisation des Queues pour tâches lourdes
- Maturité : Suivre les mises à jour, contribuer au feedback
- Lock-in : Architecture hexagonale permettant une migration si nécessaire

## Références

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [D1 Documentation](https://developers.cloudflare.com/d1/)
- [Benchmark Workers vs Lambda](https://blog.cloudflare.com/workers-vs-lambda/)
