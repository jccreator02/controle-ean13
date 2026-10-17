# Contrôle EAN13 — V5

## Installation sur smartphone

### Option recommandée : hébergement HTTPS
La caméra nécessite une page HTTPS (sauf localhost).

1. Décompresser l'archive.
2. Mettre les fichiers sur un hébergement web HTTPS.
3. Ouvrir l'adresse depuis le smartphone.
4. Autoriser l'accès à la caméra.
5. Android/Chrome : menu ⋮ → « Ajouter à l'écran d'accueil » / « Installer l'application ».
6. iPhone/Safari : bouton Partager → « Sur l'écran d'accueil ».

### Utilisation
1. Appuyer sur « Choisir un fichier » et sélectionner le TXT contenant les EAN13 de référence.
2. Appuyer sur « Démarrer le scanner ».
3. Autoriser la caméra et utiliser la caméra arrière.
4. Le scan classe automatiquement le code en OK, INCONNU ou DOUBLON.
5. Les scans apparaissent dans l'historique avec défilement.
6. « Fin du contrôle » génère le fichier Excel avec l'historique et les références manquantes.

## Important
La détection automatique EAN13 utilise l'API BarcodeDetector lorsqu'elle est disponible dans le navigateur. Si elle n'est pas disponible, la saisie manuelle reste utilisable.


V6.3 : sons OK/INCONNU/DOUBLON, délai caméra de 2,5 s, et version affichée dans le titre. Base de code V5 conservée pour éviter les régressions.
