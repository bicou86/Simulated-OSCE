# Attributions — AMBOSS-14

## ecg-stemi-anterieur.svg

- **Source** : Création originale, générée par `script/generate-ecg-stemi-anterieur.mjs` (projet OSCE Sim).
- **URL source** : N/A — fichier original non dérivé.
- **Licence** : CC0 1.0 Universal — Public Domain Dedication.
  https://creativecommons.org/publicdomain/zero/1.0/
- **Auteur** : Projet OSCE Sim (équipe plateforme).
- **Date création originale** : 2026-04-23
- **Date téléchargement / intégration OSCE Sim** : 2026-04-24
- **Checksum SHA-256** :
  `656eb9dd1c81846a73326fb6c910d985e3f53b52ae3b96f88c99b934feed9132`
- **Usage pédagogique** : ECG 12 dérivations synthétique illustrant un
  STEMI antérieur hyperaigu (H+30 min). Utilisé dans la station AMBOSS-14
  (douleur thoracique — homme 45 ans) pour surfacer l'imagerie après une
  demande d'ECG du candidat.
- **Vérification licence live** : dédicace CC0 1.0 décidée par l'équipe
  OSCE Sim 2026-04-23. Aucun dérivé de contenu sous copyright — le SVG est
  entièrement synthétisé (tracés gaussiens paramétrés).

### Spécifications cliniques encodées

Paramètres du générateur (`script/generate-ecg-stemi-anterieur.mjs`) :

- Rythme sinusal, 95 bpm.
- V1 : +3.5 mm ST, V2–V3 : +5.0 mm ST (maximal antérieur), V4 : +4.5 mm ST.
- II / III / aVF : −3.5 mm ST (miroir inférieur — vérification A amplifiée
  depuis −3 mm pour garantir la visibilité au zoom 100%).
- aVR : +1.5 mm ST (vérification C — signe de corrélation réciproque
  latérale, sens positif confirmé dans le code).
- V2–V3 : morphologie lissée via échantillonnage 500 Hz et interpolation
  linéaire sur path SVG (vérification B — pas d'artefact Bézier parasite).
- Papier : 25 mm/s, 10 mm/mV.
