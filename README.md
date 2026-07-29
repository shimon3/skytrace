# SkyTrace

SkyTrace est une carte web statique qui affiche des aéronefs à partir de données ADS-B publiques.

## Fonctionnalités

- carte Leaflet avec plusieurs fonds de carte ;
- recherche par indicatif, immatriculation ou code d’aéroport connu ;
- filtres par altitude et état au sol ;
- suivi visuel d’un aéronef ;
- trajectoire observée localement dans le navigateur ;
- interface française, anglaise et hébraïque ;
- mise en page adaptée aux écrans mobiles de 360 px de largeur.

## Important sur les données

SkyTrace ne dispose pas d’un flux mondial unique. Le navigateur interroge successivement plusieurs zones géographiques. Les positions affichées entre deux réponses de l’API sont estimées à partir de la dernière position, de la vitesse et du cap connus.

La fonction « Trajectoire » ne représente donc pas le plan de vol officiel. Elle contient uniquement les positions observées par ce navigateur pendant la sélection de l’aéronef.

## Architecture actuelle

```text
index.html       Interface principale
style.css        Styles généraux
mobile.css       Corrections spécifiques aux petits écrans
app.js           Logique historique de l’application
_headers         En-têtes de sécurité Cloudflare Pages
```

## Développement local

Un serveur HTTP est nécessaire pour éviter les restrictions associées à `file://`.

```bash
python3 -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.

## Qualité du code

```bash
npm install
npm run lint
npm run format:check
npm test
```

## Sources externes

- données aériennes : airplanes.live ;
- photographies : planespotters.net ;
- cartographie : CARTO et Esri ;
- bibliothèque cartographique : Leaflet 1.9.4.

## Confidentialité

Les trajectoires enregistrées sont stockées localement dans le navigateur avec `localStorage`. Aucun compte utilisateur ni base de données applicative n’est utilisé.
