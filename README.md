# SkyTrace

SkyTrace est une carte web statique qui affiche des aéronefs à partir de données ADS-B publiques.

## Fonctionnalités

- carte Leaflet avec plusieurs fonds de carte ;
- recherche par indicatif, immatriculation ou code d’aéroport connu ;
- filtres par altitude et état au sol ;
- suivi visuel d’un aéronef ;
- trajectoire observée localement dans le navigateur ;
- âge visible de la dernière donnée aérienne reçue ;
- interface française, anglaise et hébraïque ;
- mise en page adaptée aux écrans mobiles, notamment 360 × 780 px.

## Important sur les données

SkyTrace ne dispose pas d’un flux mondial unique. Le navigateur interroge successivement plusieurs zones géographiques. Les positions affichées entre deux réponses de l’API sont estimées à partir de la dernière position, de la vitesse et du cap connus. L’extrapolation est limitée à 90 secondes.

La fonction « Trajectoire » ne représente pas le plan de vol officiel. Elle contient uniquement les positions observées par ce navigateur pendant la sélection de l’aéronef.

Le compteur représente les aéronefs encore présents dans le cache local de la session, pas l’ensemble des vols mondiaux.

## Architecture

```text
index.html                     Interface principale et chargement du module
style.css                      Styles généraux
mobile.css                     Corrections spécifiques aux petits écrans
app.js                         Contrôleur et orchestration de l’application
data/airports.js               Catalogue des aéroports recherchables
js/api-client.js               Requêtes sérialisées, backoff et photos
js/flight-utils.js             Normalisation, conversions, filtres et projection
js/i18n.js                     Traductions et changement de langue
js/map-view.js                 Carte Leaflet et rendu Canvas
_headers                       En-têtes de sécurité Cloudflare Pages
tests/                         Tests unitaires et contrats du projet
.github/workflows/quality.yml  Validation automatique GitHub Actions
```

## Développement local

Un serveur HTTP est nécessaire, car les modules JavaScript ne doivent pas être ouverts directement avec `file://`.

```bash
python3 -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.

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

## Vérification manuelle recommandée

Après un déploiement, vérifier au minimum :

- chargement de la carte et réception des aéronefs ;
- recherche par aéroport, indicatif et immatriculation ;
- filtres, sélection, suivi, trajectoire et partage ;
- changement entre français, anglais et hébreu ;
- affichage portrait et paysage sur 360 × 780 px, 390 × 844 px et écran de bureau ;
- indication visible de l’âge de la dernière donnée.

## Sources externes

- données aériennes : airplanes.live ;
- photographies : planespotters.net ;
- cartographie : CARTO et Esri ;
- bibliothèque cartographique : Leaflet 1.9.4.

## Confidentialité

Les trajectoires enregistrées sont stockées localement dans le navigateur avec `localStorage`. Aucun compte utilisateur ni base de données applicative n’est utilisé.
