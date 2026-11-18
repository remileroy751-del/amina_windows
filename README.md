# AMINA-FDS Galerie — version Windows

Application de bureau Windows pour **ajouter / supprimer des photos et des vidéos** de la page Galerie du site AMINA-FDS.
C'est la version ordinateur de l'application Android : même principe, elle publie directement sur Netlify
(API Netlify) et le site est mis à jour en 10 à 60 secondes (plus pour les grosses vidéos).

## 1. Prérequis (une seule fois)
Le site en ligne doit contenir le fichier `galerie-data.js` (la galerie est lue depuis ce fichier).
C'est le cas si vous avez déjà publié `amina-fds-site-v6.zip` pour l'application Android.

## 2. Obtenir l'installeur — compilation automatique sur GitHub
1. Créez un dépôt **privé** sur GitHub et envoyez-y tout le contenu de ce dossier
   (y compris le dossier caché `.github`).
2. **Dès que le dépôt est reçu, la compilation démarre toute seule** (branche `main` ou `master`).
   Suivez-la dans l'onglet **Actions** → « Build Windows » (3 à 6 minutes).
3. Ouvrez l'exécution terminée → section **Artifacts** → téléchargez `AminaGalerie-Windows-Setup`.
4. Dézippez, double-cliquez sur `AminaGalerie-Setup-1.0.0.exe` et suivez l'assistant d'installation
   (choix du dossier, raccourci Bureau et menu Démarrer).

> **Windows SmartScreen** : l'installeur n'est pas signé numériquement (un certificat coûte cher).
> Si Windows affiche « Windows a protégé votre ordinateur », cliquez sur **Informations complémentaires → Exécuter quand même**.
> L'application n'est pas dangereuse : c'est le code que vous avez fourni, compilé par votre propre dépôt.

### Variante : page « Releases » (téléchargement direct, sans zip)
Pour obtenir un lien de téléchargement permanent, envoyez un tag de version :
```
git tag v1.0.0
git push origin v1.0.0
```
Le workflow publie alors l'installeur dans l'onglet **Releases** du dépôt.
(Pour une nouvelle version, changez `"version"` dans `package.json` avant de créer le tag.)

## 3. Premier lancement
Saisissez les deux informations Netlify :
- **Jeton d'accès** : Netlify → icône du profil → *User settings* → *Applications* →
  *Personal access tokens* → *New access token* (il ne s'affiche qu'une fois).
- **Site** : `nom-du-site.netlify.app` (ou l'identifiant « Project ID » de *Site configuration*).
  Vous pouvez aussi coller l'adresse complète `https://…`.

La case **« Mémoriser le jeton »** (cochée par défaut) garde le jeton **chiffré avec votre session Windows** (DPAPI) :
il n'est lisible que par votre compte Windows, sur cet ordinateur. Décochez-la si vous préférez
ressaisir le jeton à chaque ouverture. Le bouton **Déconnexion** efface le jeton mémorisé.

## 4. Utilisation
- **Photos** : « + Ajouter des photos » à côté de la catégorie → choisissez **une ou plusieurs** photos
  (ou glissez-les directement sur la catégorie) → légendes facultatives → *Publier*.
  Les photos sont redimensionnées (1600 px max) et compressées automatiquement ; plusieurs photos = **une seule** publication.
- **Vidéos** : « + Ajouter une vidéo » → fichier **MP4** → *Publier*.
  Le format (vertical ou paysage/carré) et la miniature sont détectés automatiquement.
- **Supprimer** : bouton corbeille sur la vignette → confirmer.
- **Voir le site** ouvre le site dans le navigateur ; **Actualiser** relit la galerie en ligne.
- Gardez l'application ouverte pendant l'envoi.

## Sécurité
- Un jeton personnel Netlify donne accès à **tout votre compte Netlify** (Netlify ne permet pas de le limiter à un site).
  Si l'ordinateur est perdu ou partagé : Netlify → *Applications* → supprimez le jeton.
- Le jeton n'est jamais écrit dans le code ni dans l'installeur ; il ne transite que vers `api.netlify.com`.

## À savoir (identique à la version Android)
- Seules les photos **ajoutées par l'application** sont effacées physiquement du site ; les photos d'origine sont retirées
  de la galerie mais leurs fichiers restent (certaines servent aussi sur la page d'accueil).
- Vidéos : préférez des vidéos déjà légères (< 30 Mo). Limite de sécurité : 100 Mo.
- Les catégories de photos sont fixes (Granitos Lavé, Grèx, Fauché, Granulite, Écosse). Pour en ajouter une,
  il faut modifier `galerie-data.js`.
- Si une publication échoue : vérifiez la connexion et relancez ; un échec ne casse pas le site en ligne.

## Pour les développeurs
```
npm install
npm start        # lance l'application
npm test         # test d'intégration contre un faux serveur Netlify
npm run dist     # construit l'installeur dans dist/ (à lancer sous Windows)
```
Structure : `src/main` (processus principal : API Netlify, publication, stockage chiffré),
`src/renderer` (interface), `test/` (faux Netlify + test visuel `e2e-hook.js`).
