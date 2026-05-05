# Phase 12 J4 — Audit des 97 images orphelines

Audit produit le 2026-05-05 sur la liste `imagesOrphans` du rapport `docs/phase-11-migration-report.json` (post-J3).

**Méthodologie** : pour chaque orpheline, recherche brute-force du *stem* (filename sans `.jpg`) sur **14 233 fichiers** du repo, en excluant `node_modules/`, `.git/`, `dist/`, `.cache/`, `.upm/`, `client/public/pedagogical-images/` (où vivent les images), et `docs/phase-11-migration-report.json` (auto-référence). Les fichiers `.gitignored` (notamment `tmp/phase11-pedagogy-source/`) **sont** scannés.

## Bilan

| Catégorie | Compte | Critère |
|---|---|---|
| `delete_safe` | **71** | 0 référence dans le repo |
| `keep_referenced` | **0** | ≥1 référence dans un fichier source/test/doc actif (hors `tmp/`) |
| `manual_review` | **26** | référencé uniquement dans `tmp/phase11-pedagogy-source/*.json` (champ `filename` legacy, non extrait par le script de migration qui ne lit que `data`) |
| **Total** | **97** | |

## `delete_safe` — 71 fichiers (0 référence)

Aucune référence détectée dans le repo. Sûrs à supprimer (sous réserve d'arbitrage Q-P12-A-12).

Distribution par bucket :

| Bucket | Compte | Exemples |
|---|---|---|
| `SMIG-*` | 10 | SMIG-1-img1-Physiopathologie-de-la-syncope.jpg, SMIG-1-img2-Types-de-syncopes-selon-les-etiologies.jpg, SMIG-2-Situation-1-Approche-diagnostique-dune-hyponatremie.jpg, +7 more |
| `ecc-*` | 5 | ecc_gyneco-img1.jpg, ecc_gyneco-img2.jpg, ecc_gyneco-img3.jpg, +2 more |
| `A1-*` | 4 | A1-CT-scan-cerebral-comparatif-normal.jpg, A1-CT-scan-cerebral-en-urgence.jpg, A1-ECG.jpg, +1 more |
| `Fatigue-*` | 4 | Fatigue-TBL-img1.jpg, Fatigue-TBL-img2.jpg, Fatigue-TBL-img3.jpg, +1 more |
| `A2-*` | 3 | A2-Angio-CT-en-urgence.jpg, A2-Echocardiographie-comparitive-normale.jpg, A2-Spectre-des-SCA.jpg |
| `A3-*` | 3 | A3-Classification-clinique-des-HSA-WFNS-grading-system.jpg, A3-Criteres-IM-type-1.jpg, A3-Echocardiographie-aux-urgences.jpg |
| `B1-*` | 3 | B1-ECG.jpg, B1-GFAST.jpg, B1-Score-SOFA.jpg |
| `B2-*` | 3 | B2-Algorithme-Suspicion-AVC.jpg, B2-Protocole-de-prise-en-charge-des-SCA-au-service-des-urgences-HUG.jpg, B2-Score-qSOFA.jpg |
| `FUO-*` | 3 | FUO-img1-0-2-mois.jpg, FUO-img2-0-2-mois.jpg, FUO-img3-2-mois-2-ans.jpg |
| `1-*` | 2 | 1-Radiographie-du-thorax.jpg, 1-Radiographie-du-thorax4.jpg |
| `2-*` | 2 | 2-Categories-insuffisances-respiratoires.jpg, 2-Radiographie-du-bassin.jpg |
| `A4-*` | 2 | A4-Classification-radiologique-des-HSA-Fischer-grading-system.jpg, A4-Criteres-IM-type-2.jpg |
| `B3-*` | 2 | B3-CT-scan-cerebral-en-urgence.jpg, B3-Strategie-de-stratification-du-risque-dans-les-NSTEMI-angor-instable.jpg |
| `B4-*` | 2 | B4-Strategie-de-stratification-du-risque-dans-les-NSTEMI-angor-instable.jpg, B4-Strategie-therapeutique.jpg |
| `B5-*` | 2 | B5-Causes-elevation-des-troponines.jpg, B5-Criteres-de-revascularisation-aigue-post-AVC.jpg |
| `Intermed-*` | 2 | Intermed-Dyspnee-Labo-1.jpg, Intermed-Dyspnee-Labo-2.jpg |
| `Psy-*` | 2 | Psy-Vignette-10-Episode-depressif-majeur.jpg, Psy-Vignette-9-Criteres-diagnostics-Schizophrenie.jpg |
| `VignetteClinique-*` | 2 | VignetteClinique_DRS-ECG1.jpg, VignetteClinique_DRS-ECG2.jpg |
| `diarrhees-*` | 2 | diarrhees-1-img1.jpg, diarrhees-1-img2.jpg |
| `ictere-*` | 2 | ictere-1-img1.jpg, ictere-1-img2.jpg |
| `3-*` | 1 | 3-Echographie-E-FAST.jpg |
| `4-*` | 1 | 4-Echographie-E-FAST.jpg |
| `A5-*` | 1 | A5-Temps-cibles-de-prise-en-charge.jpg |
| `A6-*` | 1 | A6-Contre-indications-a-la-fibrinolyse.jpg |
| `A7-*` | 1 | A7-Etapes-et-delais-de-la-prise-en-charge-STEMI.jpg |
| `B6-*` | 1 | B6-Criteres-de-revascularisation-aigue-post-AVC.jpg |
| `B7-*` | 1 | B7-CT-scan-cerebral-J1.jpg |
| `B8-*` | 1 | B8-Diagnostic-de-mort-cerebrale.jpg |
| `C1-*` | 1 | C1-Radiographie-du-thorax.jpg |
| `Meningite-*` | 1 | Meningite-Algorithme.jpg |
| `depression-*` | 1 | depression-1-img1.jpg |

<details><summary>Liste complète (71 fichiers)</summary>

- `1-Radiographie-du-thorax.jpg`
- `1-Radiographie-du-thorax4.jpg`
- `2-Categories-insuffisances-respiratoires.jpg`
- `2-Radiographie-du-bassin.jpg`
- `3-Echographie-E-FAST.jpg`
- `4-Echographie-E-FAST.jpg`
- `A1-CT-scan-cerebral-comparatif-normal.jpg`
- `A1-CT-scan-cerebral-en-urgence.jpg`
- `A1-ECG.jpg`
- `A1-ECG3.jpg`
- `A2-Angio-CT-en-urgence.jpg`
- `A2-Echocardiographie-comparitive-normale.jpg`
- `A2-Spectre-des-SCA.jpg`
- `A3-Classification-clinique-des-HSA-WFNS-grading-system.jpg`
- `A3-Criteres-IM-type-1.jpg`
- `A3-Echocardiographie-aux-urgences.jpg`
- `A4-Classification-radiologique-des-HSA-Fischer-grading-system.jpg`
- `A4-Criteres-IM-type-2.jpg`
- `A5-Temps-cibles-de-prise-en-charge.jpg`
- `A6-Contre-indications-a-la-fibrinolyse.jpg`
- `A7-Etapes-et-delais-de-la-prise-en-charge-STEMI.jpg`
- `B1-ECG.jpg`
- `B1-GFAST.jpg`
- `B1-Score-SOFA.jpg`
- `B2-Algorithme-Suspicion-AVC.jpg`
- `B2-Protocole-de-prise-en-charge-des-SCA-au-service-des-urgences-HUG.jpg`
- `B2-Score-qSOFA.jpg`
- `B3-CT-scan-cerebral-en-urgence.jpg`
- `B3-Strategie-de-stratification-du-risque-dans-les-NSTEMI-angor-instable.jpg`
- `B4-Strategie-de-stratification-du-risque-dans-les-NSTEMI-angor-instable.jpg`
- `B4-Strategie-therapeutique.jpg`
- `B5-Causes-elevation-des-troponines.jpg`
- `B5-Criteres-de-revascularisation-aigue-post-AVC.jpg`
- `B6-Criteres-de-revascularisation-aigue-post-AVC.jpg`
- `B7-CT-scan-cerebral-J1.jpg`
- `B8-Diagnostic-de-mort-cerebrale.jpg`
- `C1-Radiographie-du-thorax.jpg`
- `FUO-img1-0-2-mois.jpg`
- `FUO-img2-0-2-mois.jpg`
- `FUO-img3-2-mois-2-ans.jpg`
- `Fatigue-TBL-img1.jpg`
- `Fatigue-TBL-img2.jpg`
- `Fatigue-TBL-img3.jpg`
- `Fatigue-TBL-img4-Examens-paracliniques.jpg`
- `Intermed-Dyspnee-Labo-1.jpg`
- `Intermed-Dyspnee-Labo-2.jpg`
- `Meningite-Algorithme.jpg`
- `Psy-Vignette-10-Episode-depressif-majeur.jpg`
- `Psy-Vignette-9-Criteres-diagnostics-Schizophrenie.jpg`
- `SMIG-1-img1-Physiopathologie-de-la-syncope.jpg`
- `SMIG-1-img2-Types-de-syncopes-selon-les-etiologies.jpg`
- `SMIG-2-Situation-1-Approche-diagnostique-dune-hyponatremie.jpg`
- `SMIG-2-Situation-2-Criteres-diagnostiques-du-SIADH.jpg`
- `SMIG-2-Situation-3-Diagnostic-differentiel-dune-hypernatremie.jpg`
- `SMIG-3-img1-Definitions-et-diagnostic-du-diabete.jpg`
- `SMIG-3-img2-Mecanismes-physiopathologiques-des-decompensations-diabetiques.jpg`
- `SMIG-3-img3-Tableau-comparatif-des-decompensations-acido-cetosique-et-hyperosmolaire.jpg`
- `SMIG-4-img1-Radiographie-thorax-face.jpg`
- `SMIG-4-img2-Radiographie-thorax-profil.jpg`
- `VignetteClinique_DRS-ECG1.jpg`
- `VignetteClinique_DRS-ECG2.jpg`
- `depression-1-img1.jpg`
- `diarrhees-1-img1.jpg`
- `diarrhees-1-img2.jpg`
- `ecc_gyneco-img1.jpg`
- `ecc_gyneco-img2.jpg`
- `ecc_gyneco-img3.jpg`
- `ecc_gyneco-img4.jpg`
- `ecc_gyneco-img5.jpg`
- `ictere-1-img1.jpg`
- `ictere-1-img2.jpg`

</details>

## `manual_review` — 26 fichiers (référencés via `filename` legacy)

Ces images sont **référencées dans `tmp/phase11-pedagogy-source/*.json`** mais via le champ legacy `filename` (avec `data: null`). Le script `migrate-pedagogical-content.ts` n'extrait que `data` : ces images ne sont donc **pas remontées** dans le `pedagogicalContent` des stations correspondantes. Concrètement, ces 12 stations RESCOS ont une iconographie source qui n'est pas migrée :

| Station source | Images orphelines associées |
|---|---|
| `RESCOS-17 - Douleur abdominale` | `douleur-abdo-1-img1.jpg` |
| `RESCOS-19 - Douleur abdominale` | `douleur-abdo-3-img1.jpg` |
| `RESCOS-20 - Douleur abdominale` | `douleur-abdo-4-img1.jpg`, `douleur-abdo-4-img2.jpg`, `douleur-abdo-4-img3.jpg`, `douleur-abdo-4-img4.jpg` |
| `RESCOS-24 - Douleur au flanc` | `douleur-au-flanc-1-img1.jpg`, `douleur-au-flanc-1-img2.jpg`, `douleur-au-flanc-1-img3.jpg` |
| `RESCOS-32 - Douleur oculaire` | `oeil-rouge-img1.jpg` |
| `RESCOS-34 - Douleur thoracique` | `douleur-thoracique-1-img1.jpg`, `douleur-thoracique-1-img2.jpg` |
| `RESCOS-35 - Douleur thoracique` | `douleur-thoracique-2-img1.jpg`, `douleur-thoracique-2-img2.jpg`, `douleur-thoracique-2-img3.jpg` |
| `RESCOS-41 - Dysurie` | `dysurie-2-img1.jpg`, `dysurie-2-img2.jpg`, `dysurie-2-img3.jpg` |
| `RESCOS-44 - Fatigue` | `fatigue-1-img1.jpg`, `fatigue-1-img2.jpg` |
| `RESCOS-48 - Lombalgie` | `douleur-dorsale-1-img1.jpg`, `douleur-dorsale-1-img2.jpg` |
| `RESCOS-5 - AVP` | `urgence-1-img1.jpg`, `urgence-1-img2.jpg`, `urgence-1-img3.jpg` |
| `RESCOS-50 - Malaise` | `syncope-1-img1.jpg` |

### Tableau détaillé des `manual_review`

| filename | bucket | refs | source |
|---|---|---|---|
| `douleur-abdo-1-img1.jpg` | `douleur` | 1 | RESCOS-17 - Douleur abdominale.json |
| `douleur-abdo-3-img1.jpg` | `douleur` | 1 | RESCOS-19 - Douleur abdominale.json |
| `douleur-abdo-4-img1.jpg` | `douleur` | 1 | RESCOS-20 - Douleur abdominale.json |
| `douleur-abdo-4-img2.jpg` | `douleur` | 1 | RESCOS-20 - Douleur abdominale.json |
| `douleur-abdo-4-img3.jpg` | `douleur` | 1 | RESCOS-20 - Douleur abdominale.json |
| `douleur-abdo-4-img4.jpg` | `douleur` | 1 | RESCOS-20 - Douleur abdominale.json |
| `douleur-au-flanc-1-img1.jpg` | `douleur` | 1 | RESCOS-24 - Douleur au flanc.json |
| `douleur-au-flanc-1-img2.jpg` | `douleur` | 1 | RESCOS-24 - Douleur au flanc.json |
| `douleur-au-flanc-1-img3.jpg` | `douleur` | 1 | RESCOS-24 - Douleur au flanc.json |
| `douleur-dorsale-1-img1.jpg` | `douleur` | 1 | RESCOS-48 - Lombalgie.json |
| `douleur-dorsale-1-img2.jpg` | `douleur` | 1 | RESCOS-48 - Lombalgie.json |
| `douleur-thoracique-1-img1.jpg` | `douleur` | 1 | RESCOS-34 - Douleur thoracique.json |
| `douleur-thoracique-1-img2.jpg` | `douleur` | 1 | RESCOS-34 - Douleur thoracique.json |
| `douleur-thoracique-2-img1.jpg` | `douleur` | 1 | RESCOS-35 - Douleur thoracique.json |
| `douleur-thoracique-2-img2.jpg` | `douleur` | 1 | RESCOS-35 - Douleur thoracique.json |
| `douleur-thoracique-2-img3.jpg` | `douleur` | 1 | RESCOS-35 - Douleur thoracique.json |
| `dysurie-2-img1.jpg` | `dysurie` | 1 | RESCOS-41 - Dysurie.json |
| `dysurie-2-img2.jpg` | `dysurie` | 1 | RESCOS-41 - Dysurie.json |
| `dysurie-2-img3.jpg` | `dysurie` | 1 | RESCOS-41 - Dysurie.json |
| `fatigue-1-img1.jpg` | `fatigue` | 1 | RESCOS-44 - Fatigue.json |
| `fatigue-1-img2.jpg` | `fatigue` | 1 | RESCOS-44 - Fatigue.json |
| `oeil-rouge-img1.jpg` | `oeil` | 1 | RESCOS-32 - Douleur oculaire.json |
| `syncope-1-img1.jpg` | `syncope` | 1 | RESCOS-50 - Malaise.json |
| `urgence-1-img1.jpg` | `urgence` | 1 | RESCOS-5 - AVP.json |
| `urgence-1-img2.jpg` | `urgence` | 1 | RESCOS-5 - AVP.json |
| `urgence-1-img3.jpg` | `urgence` | 1 | RESCOS-5 - AVP.json |

### Extrait contextuel — exemple `RESCOS-41 - Dysurie.json`

Structure observée dans 12 sources RESCOS (data null + filename peuplé) :

```json
"images": [
  {
    "data": null,
    "filename": "grilles_generees/html/images/dysurie-2-img1.jpg"
  },
  {
    "data": null,
    "filename": "grilles_generees/html/images/dysurie-2-img2.jpg"
  }
]
```

Le script `migrate-pedagogical-content.ts:251-256` filtre ces entrées (`if (typeof dataRaw !== "string") { imagesOmitted++; continue; }`) → l'image n'est ni migrée ni référencée → classée orpheline.

## Question pré-J5 — Q-P12-A-12

Le brief J4 propose 3 options. Avec la donnée d'audit, leur impact est :

- **(a) Supprimer** : 97 images supprimées (delete_safe + manual_review). **Risque** : les 26 `manual_review` ont une référence `filename` dans `tmp/phase11-pedagogy-source/*.json` ; suppression empêche toute récupération future via re-migration enrichie.
- **(b) Corbeille `tmp/phase-12-orphans-deleted/` (recommandation Claude Chrome)** : 97 images déplacées via `git mv`, réversibles. Convergente avec J5 (snapshot phase2 régénéré sans drift résiduel sur ces images).
- **(c) Conserver** : 0 action. Les 26 `manual_review` restent disponibles pour une éventuelle Phase 13 qui étendrait le script à lire `filename` comme fallback de `data`.

**Recommandation alternative — option (d)** : `delete_safe` (71) supprimées via corbeille, `manual_review` (26) **conservées** sur disque + tracées comme dette explicite (« iconographie RESCOS non migrée — 26 images, 12 stations »). Ce split aligne action irréversible (suppression) sur ce qui n'a vraiment aucune référence, tout en préservant les 26 images théoriquement récupérables via une extension future du script.

## Vérifications invariants (rappel)

- **6 baselines byteLength HTTP** : aucune des 97 orphelines n'est référencée par AMBOSS-24, USMLE-34, USMLE-9, RESCOS-64, RESCOS-64-P2, RESCOS-72 (vérifié — leurs `pedagogicalContent.images[].data` pointent vers des slugs migrés présents sur disque, pas vers les orphelines).
- **278 stations sha256-verrouillées** : les orphelines ne sont pas dans les 280 références `pedagogicalContent.images[].data` du corpus migré → leur suppression n'affectera **aucun sha256** stations.
- **Schéma additif strict** : la suppression n'est pas additive → validation utilisateur obligatoire (Q-P12-A-12).

## Statut J4

`Statut J4 : AUDIT LIVRÉ — aucune action sur disque, aucun fichier modifié. En attente arbitrage Q-P12-A-12.`
