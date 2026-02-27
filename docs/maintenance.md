# Maintenance technique

Ce document s'adresse aux personnes qui maintiennent le site (technique / déploiement).

## Contenu du depot

- `wp-content/` : thèmes, plugins et assets du site (WordPress core n'est pas versionné ici).
- `wp-content/themes/echecs92-child/` : thème enfant (basé sur `twentytwentyfive`).
- `scripts/` : scripts de maintenance (synchronisation et generation de donnees).
- `.github/workflows/` : automatisations (déploiement, synchronisations, sauvegardes).
- `deploy/` : snippets de configuration (OVH, etc.).
- `archive-wayback/` : archive historique (si utile).

## Formulaire de contact (reCAPTCHA)

Le formulaire de contact est fourni par le thème enfant `echecs92-child` via le shortcode :

- `[cdje92_contact_form]`

Il est protégé par **Google reCAPTCHA v2** (case "Je ne suis pas un robot").
Si reCAPTCHA n'est pas configuré, le formulaire est désactivé.

### Configuration des cles

Option 1 (recommandée) : dans l'admin WordPress :

1. `Réglages` -> `Contact CDJE 92`
2. Renseigner la clé du site + la clé secrète
3. Enregistrer

Option 2 : définir les clés côté serveur (pratique sur OVH mutualisé), par exemple dans `wp-config.php` :

```php
define('CDJE92_RECAPTCHA_SITE_KEY', '...');
define('CDJE92_RECAPTCHA_SECRET_KEY', '...');
```

Snippets prets a l'emploi :

- `deploy/ovh/wp-config.recaptcha.snippet.php`
- `deploy/ovh/htaccess.recaptcha.snippet.conf`

Option 3 : fournir un fichier de secrets (non commité) :

- `wp-content/.secrets/recaptcha.php` (ou `wp-content/themes/echecs92-child/config/recaptcha.php`)

Exemple : `wp-content/themes/echecs92-child/config/recaptcha.example.php`.

### En local (Docker + localhost)

Sur `http://localhost:8080`, reCAPTCHA peut refuser des clés limitées au domaine de production.
Utiliser des clés dédiées à `localhost` ou les **clés de test** (voir `wp-content/themes/echecs92-child/config/recaptcha.example.php`).

## Développement local (Docker)

Le dépôt inclut un environnement WordPress + MySQL via `docker-compose.yml` :

```bash
docker compose up
```

Puis ouvrir `http://localhost:8080`.

## Déploiement

Le déploiement du contenu de `wp-content/` est automatisé via GitHub Actions (workflows dans `.github/workflows/`).

### Données FFE (déploiement atomique)

Les workflows de synchro FFE déploient désormais les données via un dossier de staging FTP puis un swap final :

- upload dans `assets/data.__staging`
- bascule atomique vers `assets/data` en fin de run

Ce mécanisme évite les états intermédiaires visibles sur le site pendant la synchronisation.

### Pipelines découpés (runs indépendants)

La synchro est découpée en plusieurs workflows indépendants pour isoler les erreurs et les temps d'exécution :

- `.github/workflows/ffe-licenses-sync.yml` : met à jour uniquement les compteurs de licences (toutes les 3 heures, `10 */3 * * *`).
- `.github/workflows/ffe-data-sync.yml` : synchro FFE "coeur" (clubs + détails + listes FFE) (toutes les 6 heures, `35 */6 * * *`).
- `.github/workflows/ffe-players-index-sync.yml` : reconstruit l'index joueurs (`ffe-players/*`) (toutes les 4 heures, `50 */4 * * *`, + déclenchement automatique après un run core réussi).
- `.github/workflows/fide-official-sync.yml` : synchro officielle FIDE (`fide-players/*`) (toutes les 6 heures, `25 */6 * * *`, + passage hebdo archives `20 1 * * 0`).
- `.github/workflows/ffe-hints-sync.yml` : régénère les hints d'adresses (quotidien, `50 2 * * *`).

Ce découpage permet :

- d'identifier précisément quel bloc échoue ;
- de relancer uniquement le bloc nécessaire ;
- de comparer facilement les durées par workflow.

Pour les workflows de synchro qui lisent d'abord les données via FTP (`ffe-data-sync.yml`, `ffe-players-index-sync.yml`, `fide-official-sync.yml`, `ffe-licenses-sync.yml`, `ffe-hints-sync.yml`) :

- les erreurs FTP transitoires de type `550` sont tolérées pendant la récupération ;
- un fallback automatique tente ensuite de compléter depuis `assets/data.__staging`.

Objectif : éviter qu'un run échoue uniquement parce qu'un fichier est momentanément indisponible pendant le swap.

### Tolérance côté frontend (joueurs)

Les pages joueurs (`assets/js/players.js` et `assets/js/player-detail.js`) tentent d'abord de charger les JSON dans `assets/data/`, puis basculent automatiquement vers `assets/data.__staging/` si nécessaire.

Objectif : garder la recherche joueur et les fiches utilisables même pendant la bascule finale des données.

### Données FIDE (source officielle + enrichissement)

Le workflow dédié `.github/workflows/fide-official-sync.yml` lance :

- `node scripts/sync-fide-official-data.js`

Ce script :

- télécharge la **liste officielle FIDE** (`players_list.zip`) depuis `ratings.fide.com`;
- génère des shards locaux dans `wp-content/themes/echecs92-child/assets/data/fide-players/by-id/`;
- produit un manifeste `.../fide-players/manifest.json`;
- indexe toutes les périodes d'archives via `a_download.php?period=...` dans `.../fide-players/archives.json`;
- télécharge en option des archives ZIP locales (`.../fide-players/archives/<periode>/`).

Variables utiles :

- `FIDE_ARCHIVE_PERIODS` : nombre de périodes d'archives à télécharger (`1` par défaut, `0` pour désactiver, `all` pour tout).
- `FIDE_ARCHIVE_INCLUDE_XML` : `1` pour télécharger aussi les archives XML (défaut `0`).
- `FIDE_MAX_ROWS` : debug local uniquement (limite de lignes parsées).

Mode planifié :

- run 6h (`25 */6 * * *`) : `FIDE_ARCHIVE_PERIODS=0` (rafraîchissement rapide de la liste officielle).
- run hebdo (`20 1 * * 0`) : `FIDE_ARCHIVE_PERIODS=1` (rafraîchissement des archives récentes).

La fiche joueur combine ensuite :

- la source officielle FIDE (fichiers mensuels);
- et l'enrichissement "live" (scraping des pages profil FIDE),

avec comparaison automatique entre les deux sources et liens de citation.
