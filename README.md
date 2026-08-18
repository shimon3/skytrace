# SkyTrace

SkyTrace est une carte web qui affiche des aéronefs en direct à partir de données ADS-B publiques, installable comme application (PWA) et administrable via un tableau de bord privé.

## Fonctionnalités

- carte Leaflet avec plusieurs fonds de carte ;
- recherche par indicatif, immatriculation ou code d’aéroport connu ;
- filtres par altitude et état au sol ;
- suivi visuel d’un aéronef ;
- trajectoire observée localement dans le navigateur ;
- âge visible de la dernière donnée aérienne reçue ;
- horaires commerciaux (départ/arrivée, retard, porte) via AirLabs, quand configuré ;
- interface française, anglaise et hébraïque ;
- mise en page adaptée aux écrans mobiles, notamment 360 × 780 px ;
- installable comme application (PWA), avec un shell fonctionnel hors-ligne ;
- tableau de bord d’administration privé (état des fournisseurs, quota, pause).

## Important sur les données

SkyTrace ne dispose pas d’un flux mondial unique. Le navigateur interroge successivement plusieurs zones géographiques via un proxy Cloudflare qui bascule automatiquement entre deux fournisseurs (adsb.lol et airplanes.live, avec retry ponctuel sur les pannes transitoires). Les positions affichées entre deux réponses de l’API sont estimées à partir de la dernière position, de la vitesse et du cap connus. L’extrapolation est limitée à 90 secondes.

La fonction « Trajectoire » ne représente pas le plan de vol officiel. Elle contient uniquement les positions observées par ce navigateur pendant la sélection de l’aéronef.

Le compteur représente les aéronefs encore présents dans le cache local de la session, pas l’ensemble des vols mondiaux.

## Architecture

```text
index.html                        Interface principale et chargement du module
admin.html                        Tableau de bord d'administration (statique)
admin.js                          Logique du tableau de bord
style.css                         Styles généraux
mobile.css                        Corrections spécifiques aux petits écrans
flight-status.css                 Styles du panneau « informations du vol »
panel-wide-layout.css             Panneau détail avion élargi (desktop)
app.js                            Contrôleur et orchestration de l'application
data/airports.js                  Catalogue des aéroports recherchables
js/api-client.js                  Requêtes sérialisées, backoff et photos
js/flight-utils.js                Normalisation, conversions, filtres et projection
js/i18n.js                        Traductions et changement de langue
js/map-view.js                    Carte Leaflet et rendu Canvas
js/flight-status-integration.js   Affichage des horaires commerciaux (AirLabs)
functions/api/aircraft.js         Proxy positions : fallback fournisseurs, cache, retry, rate-limit
functions/api/photo.js            Proxy photo (planespotters.net)
functions/api/flight-status.js    Proxy horaires commerciaux (AirLabs)
functions/api/admin-stats.js      Statistiques d'utilisation (protégé par jeton)
functions/api/admin-provider-control.js  Pause/reprise manuelle d'un fournisseur
functions/lib/stats.js            Compteurs partagés (KV Cloudflare)
functions/lib/provider-controls.js  État pause/actif par fournisseur (KV Cloudflare)
manifest.json / sw.js             Manifeste PWA et service worker (cache-first + shell hors-ligne)
wrangler.toml                     Binding KV pour le développement local
.dev.vars.example                 Modèle des secrets locaux (jamais commité une fois copié)
_headers                          En-têtes de sécurité Cloudflare Pages
tests/                            Tests unitaires (frontend et fonctions Cloudflare)
.github/workflows/quality.yml     Validation automatique GitHub Actions
```

## Développement local

Un serveur HTTP est nécessaire, car les modules JavaScript ne doivent pas être ouverts directement avec `file://`.

```bash
python3 -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.

### Développement avec les fonctions Cloudflare Pages (admin, proxy avions/photos)

Le dossier `functions/` (routes `/api/*`) nécessite Wrangler plutôt qu'un simple serveur statique :

```bash
cp .dev.vars.example .dev.vars   # puis renseigner AIRLABS_API_KEY et ADMIN_STATS_TOKEN
npm run dev
```

`wrangler.toml` déclare le binding KV `SKYTRACE_STATS` (stats et pause fournisseur) utilisé aussi en production. `.dev.vars` n'est jamais commité (voir `.gitignore`).

## Fonctions Cloudflare Pages (API)

Le dossier `functions/api/` proxifie les fournisseurs externes plutôt que de les appeler directement depuis le navigateur : mise en cache, secrets côté serveur, limitation de débit et statistiques d'usage.

| Route                              | Rôle                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/aircraft`                | Positions ADS-B. Bascule automatiquement entre `adsb.lol` et `airplanes.live` selon le paramètre `prefer` et le quota journalier restant, avec une tentative de retry unique sur panne transitoire (502/503/504, timeout, erreur réseau — jamais sur 4xx). Sert une réponse en cache, ou une réponse « périmée » (stale), si les deux fournisseurs échouent. |
| `GET /api/photo`                   | Photo d'immatriculation via planespotters.net, mise en cache.                                                                                                                                                                                                                                                                                                |
| `GET /api/flight-status`           | Horaires commerciaux via AirLabs (nécessite `AIRLABS_API_KEY`).                                                                                                                                                                                                                                                                                              |
| `GET /api/admin-stats`             | Statistiques d'usage et santé par fournisseur (protégé par `ADMIN_STATS_TOKEN`).                                                                                                                                                                                                                                                                             |
| `POST /api/admin-provider-control` | Suspend, réactive ou teste un fournisseur (protégé par `ADMIN_STATS_TOKEN`). Refuse de suspendre le dernier fournisseur de position encore actif.                                                                                                                                                                                                            |

`/api/aircraft` applique une limite de 60 requêtes/minute par adresse IP. Toutes les routes respectent les pauses définies via le panneau d'administration.

## Panneau d'administration

`admin.html` (route `/admin.html`) affiche les statistiques d'usage, l'état de chaque fournisseur (opérationnel, limité, suspendu…) et permet de suspendre ou réactiver un fournisseur manuellement, par exemple en cas de panne ou de quota bientôt atteint. L'accès nécessite le jeton `ADMIN_STATS_TOKEN` (saisi une fois, conservé en `sessionStorage` — jamais côté serveur au-delà de la comparaison). La page n'est pas indexée (`robots: noindex`) et n'est liée depuis aucune autre page du site.

## Progressive Web App

Le manifeste (`manifest.json`) et le service worker (`sw.js`) rendent SkyTrace installable. Les fichiers statiques (CSS, JS, données, icônes) et le shell HTML sont mis en cache après la première visite ; l'application se recharge donc correctement hors-ligne, même si les données de vol elles-mêmes nécessitent une connexion. Le cache est invalidé à chaque déploiement via le paramètre de version (`?v=…`, à incrémenter dans `index.html` **et** `sw.js` lors de tout changement de fichier statique — sinon les visiteurs déjà venus continuent de voir l'ancienne version).

## Installation et validation

```bash
npm install
npm run lint
npm run format:check
npm test
```

GitHub Actions exécute automatiquement ces vérifications pour chaque pull request et chaque mise à jour de `main`.

## Déploiement Cloudflare Pages

Le projet ne nécessite pas de compilation. La configuration attendue est :

```text
Framework preset : None
Build command    : vide
Output directory : /
```

Le fichier `_headers` est appliqué par Cloudflare Pages pour définir la CSP et les autres en-têtes de sécurité.

Les fonctions (`functions/api/`) nécessitent, dans les réglages du projet Cloudflare Pages :

- un binding KV nommé `SKYTRACE_STATS` (stats d'usage et pause fournisseur — dégrade proprement sur un cache temporaire si absent, mais les valeurs ne persistent pas entre déploiements) ;
- les secrets `AIRLABS_API_KEY` (horaires commerciaux) et `ADMIN_STATS_TOKEN` (accès au tableau de bord) ; ces valeurs ne sont jamais lisibles une fois enregistrées, y compris par l'équipe de développement.

## Vérification manuelle recommandée

Après un déploiement, vérifier au minimum :

- chargement de la carte et réception des aéronefs ;
- recherche par aéroport, indicatif et immatriculation ;
- filtres, sélection, suivi, trajectoire et partage ;
- changement entre français, anglais et hébreu ;
- affichage portrait et paysage sur 360 × 780 px, 390 × 844 px et écran de bureau ;
- indication visible de l’âge de la dernière donnée ;
- accès au tableau de bord `/admin.html` avec le bon jeton ;
- chargement de l'application hors-ligne après une première visite (mode avion, une fois installée).

## Sources externes

- données aériennes : adsb.lol et airplanes.live (bascule automatique) ;
- horaires commerciaux : AirLabs ;
- photographies : planespotters.net ;
- cartographie : CARTO et Esri ;
- bibliothèque cartographique : Leaflet 1.9.4.

## Confidentialité

Les trajectoires enregistrées sont stockées localement dans le navigateur avec `localStorage`. Aucun compte utilisateur ni base de données applicative n’est utilisé.

Le jeton d'administration, une fois saisi sur `/admin.html`, est conservé en `sessionStorage` (effacé à la fermeture de l'onglet) et n'est jamais journalisé côté serveur.
