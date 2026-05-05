# Phase 12 J3 — Stations non-applicables au schéma `pedagogicalContent`

**Décision** : Phase 12 J3 acte **63 stations** comme **structurellement non-applicables** au schéma pédagogique `pedagogicalContent` (`resume` / `presentationPatient` / `theoriePratique` / `informationsExpert` / `scenarioPatienteStandardisee` / `images`). Aucune injection automatique possible depuis les sources actuelles ; aucune dette résiduelle, fermeture du périmètre.

## Bilan post-J3

| Catégorie | Total stations | Avec `pedagogicalContent` | Sans `pedagogicalContent` |
|---|---|---|---|
| AMBOSS | 40 | 40 | 0 |
| German | 88 | 26 | 62 |
| RESCOS | 76 | 75 | 1 |
| USMLE | 44 | 44 | 0 |
| USMLE Triage | 40 | 40 | 0 |
| **Total** | **288** | **225** | **63** |

Progression : 219 (Phase 11 J3) → **225** (Phase 12 J3, +6) sur 288 (78,1 %).

## Stations non-applicables (63)

### 62 German — structure OSCE pure (grille d'évaluation, pas de narratif)

**Raison** : les 62 fichiers source `tmp/phase11-pedagogy-source/German-*.json` ont `annexes: {}` vide. Leur contenu est exclusivement dans `sections[].criteria/weight` — des grilles d'évaluation pondérées destinées aux examinateurs OSCE, sans narration apprenante (résumé, présentation type, théorie). La structure source ne porte aucun champ extractible vers `pedagogicalContent`.

**Décision** : non-applicable au schéma actuel par construction. Réutilisation possible en Phase ultérieure si un schéma `evaluationGrid` distinct est introduit (hors scope Phase 12).

| ID | Titre |
|---|---|
| German-1 | Abus d'alcool |
| German-2 | Acouphènes |
| German-3 | Allaitement - Pédiatrie |
| German-4 | Anxiété |
| German-6 | Bouffées de chaleur |
| German-7 | Bradycardie |
| German-8 | Céphalées |
| German-9 | Céphalées |
| German-10 | Chute |
| German-11 | Chute |
| German-12 | Constipation |
| German-14 | Difficultés scolaires - Pédiatrie |
| German-16 | Douleur abdominale |
| German-17 | Douleur abdominale |
| German-18 | Douleur abdominale |
| German-20 | Douleur abdominale |
| German-21 | Douleur abdominale |
| German-26 | Douleur aux jambes |
| German-28 | Douleur à l'oreille - Pédiatrie |
| German-30 | Douleur thoracique |
| German-31 | Douleur thoracique |
| German-32 | Douleur thoracique |
| German-33 | Douleur thoracique |
| German-35 | Dyspnée |
| German-37 | Dysurie |
| German-38 | EM Tabac |
| German-39 | EM Vaccinations - Pédiatrie |
| German-40 | Enurésie - Pédiatrie |
| German-41 | Epilepsie |
| German-45 | Fatigue |
| German-46 | Fatigue |
| German-47 | Fatigue |
| German-49 | Gonflement abdominal |
| German-50 | Gonflement du visage |
| German-51 | Hématurie |
| German-52 | Hémoptysie |
| German-53 | Hypertension |
| German-54 | Hypertension |
| German-55 | Ictère |
| German-59 | Lombalgie |
| German-60 | Malaise |
| German-62 | Masse mammaire |
| German-63 | Ménopause |
| German-64 | Obésité |
| German-65 | Otorrhée - Pédiatrie |
| German-66 | Palpitations |
| German-67 | Perte auditive |
| German-70 | Pleurs inconsolables - Pédiatrie |
| German-71 | Pollakiurie |
| German-73 | Saignement vaginal |
| German-74 | Tachycardie |
| German-76 | Toux |
| German-77 | Toux |
| German-79 | Toux - Consultation téléphonique - Pédiatrie |
| German-80 | Tremblement |
| German-81 | Troubles de l'érection |
| German-82 | Troubles du sommeil |
| German-83 | Troubles sensoriels aux pieds |
| German-84 | Vomissements - Consultation téléphonique - Pédiatrie |
| German-85 | Vomissements et diarrhée - Pédiatrie |
| German-86 | Voyage au Brésil |
| German-87 | Voyage à Madagascar |

### 1 RESCOS — pas d'`annexes` du tout

**Raison** : la source `tmp/phase11-pedagogy-source/RESCOS-11 - Chute.json` a uniquement `{title, context, sections}` au top-level (même profil structurel que les German), sans aucune `annexes`. Ni la migration Phase 11 J3 (`resume` / `presentationPatient` / `theoriePratique`) ni l'extension Phase 12 J3 (`informationsExpert` / `scenarioPatienteStandardisee`) n'a de champ à extraire.

**Décision** : non-applicable au schéma actuel. Une re-déposition manuelle d'une source enrichie (avec `annexes`) en Phase ultérieure permettrait la migration sans modification du script.

| ID | Titre |
|---|---|
| RESCOS-11 | Chute |

## Stations couvertes par l'extension Phase 12 J3 (récap)

| ID | Champ(s) injecté(s) |
|---|---|
| RESCOS-29 - Douleur à la jambe | `informationsExpert`, `scenarioPatienteStandardisee` |
| RESCOS-57 - Ralentissement - Consultation téléphonique EMS | `informationsExpert`, `scenarioPatienteStandardisee` |
| RESCOS-64 - Toux - Station double 2 (RESCOS-64-P2) | `resume`, `presentationPatient`, `theoriePratique` |
| RESCOS-70 - Contraception cachée + effets secondaires - Adolescente 16 ans | `resume`, `presentationPatient`, `theoriePratique` |
| RESCOS-71 - Fin de vie à domicile - Accompagnante épuisée | `resume`, `presentationPatient`, `theoriePratique` |
| RESCOS-72 - Certificat de complaisance - Arrêt de travail abusif | `resume`, `presentationPatient`, `theoriePratique` |
| AMBOSS-25 - Douleur au genou - Femme 47 ans | image #6 récupérée (path source corrigé vers slug court) |

## Champs auxiliaires non extraits par défaut

**Constat** : 189 sources `tmp/phase11-pedagogy-source/*.json` contiennent dans leurs `annexes` les champs `informationsExpert` et/ou `scenarioPatienteStandardisee` (ex. AMBOSS-1, AMBOSS-2, RESCOS-1, USMLE-1, etc.). Ces champs portent des informations utiles (rôle examinateur, scénario patient simulé) mais **ne sont pas rendus** par [client/src/components/ReportPdf.tsx](client/src/components/ReportPdf.tsx) — le PDF utilisateur final n'expose actuellement que `resume`, `presentationPatient`, `theoriePratique` et `images`.

**Décision Q-P12-A-7 = (B)** : extraction *fallback ciblée* uniquement.

Le script [scripts/migrate-pedagogical-content.ts](scripts/migrate-pedagogical-content.ts) extrait `informationsExpert` / `scenarioPatienteStandardisee` UNIQUEMENT lorsque la condition `hasCanonicalContent === false` (i.e. aucun des 3 champs canoniques `resume` / `presentationPatient` / `theoriePratique` n'est présent dans la source). En pratique, cette condition est vraie pour 2 stations seulement : **RESCOS-29** et **RESCOS-57**, qui sans ce fallback resteraient classées `content=null`.

Pour les **187 stations restantes** (189 sources auxiliaires – 2 fallback déclenchés), `informationsExpert` / `scenarioPatienteStandardisee` **ne sont pas extraits** et restent uniquement dans les fichiers source. Cela évite un élargissement massif et silencieux du contrat data sans audit éditorial.

**Critère d'arbitrage retenu** :
- Coût de l'extraction systématique (option A rejetée) : +189 stations enrichies, +189 sha256 en drift (J5 alourdi), aucun bénéfice utilisateur immédiat (PDF ne les rend pas).
- Bénéfice d'option (B) : drift sha256 limité à 9 stations, fidélité au principe « ce qui est exposé via API est ce qui est rendu ».

**Réversibilité — évolution future possible** : l'extraction systématique peut être réintroduite via un flag d'environnement, par exemple :

```ts
const includeAuxiliary =
  !hasCanonicalContent || process.env.MIGRATE_INCLUDE_AUXILIARY === "1";
if (includeAuxiliary) {
  if (annexes.informationsExpert !== undefined) { ... }
  if (annexes.scenarioPatienteStandardisee !== undefined) { ... }
}
```

Ce flag n'est **pas implémenté en Phase 12 J3**, juste documenté ici comme évolution possible. Une telle évolution nécessiterait :
1. Mise à jour de `ReportPdf.tsx` pour rendre ces 2 blocs (ou nouvelle vue UI dédiée).
2. Audit éditorial du contenu auxiliaire (notamment `scenarioPatienteStandardisee` qui peut contenir des indices factuels).
3. Re-validation de l'invariant I13/I14 (cloisonnement LLM patient — vérifier que `META_FIELDS_TO_STRIP` couvre toujours le bloc complet).

**Schéma Zod** : la déclaration explicite des 2 champs optionnels dans [shared/pedagogical-content-schema.ts](shared/pedagogical-content-schema.ts) est **conservée en Phase 12 J3** indépendamment de la stratégie d'extraction. Cela garantit le typage TypeScript pour les 2 stations migrées en fallback (RESCOS-29, RESCOS-57) et reste cohérent avec une éventuelle réactivation future de l'extraction systématique.

## Iconographie RESCOS non migrée (Phase 12)

Audit J4 a révélé 26 images conservées sur disque mais non rattachées au
`pedagogicalContent` runtime. Cause : le script Phase 11 J3
([scripts/migrate-pedagogical-content.ts](scripts/migrate-pedagogical-content.ts))
ignore les entrées d'annexes dont le champ `data` est absent au profit du seul
champ `filename` (legacy structure). Voir le détail dans
[docs/phase-12-orphans-audit.md](phase-12-orphans-audit.md) section
`manual_review` (lignes 132-180).

**Décision Q-P12-A-12 = (d)** : ces 26 images sont **conservées sur disque** dans
`client/public/pedagogical-images/` (contrairement aux 71 `delete_safe` déplacées en
corbeille `tmp/phase-12-orphans-deleted/` au commit J4bis). Justification :
référence `filename` présente dans `tmp/phase11-pedagogy-source/*.json` rend ces
images récupérables via une extension future du script.

**Correction prévue — Q-P12-A-13 = oui** : J4ter (Phase 12) — extension du script
avec fallback `filename → basename → slug → lookup disque` pour migrer ces 26
images vers leurs 12 stations RESCOS d'origine.

### Stations concernées (12 RESCOS, 26 images)

| Station | Nb images | Bucket | Source |
|---|---|---|---|
| RESCOS-17 - Douleur abdominale | 1 | douleur | `douleur-abdo-1-img1.jpg` |
| RESCOS-19 - Douleur abdominale | 1 | douleur | `douleur-abdo-3-img1.jpg` |
| RESCOS-20 - Douleur abdominale | 4 | douleur | `douleur-abdo-4-img{1..4}.jpg` |
| RESCOS-24 - Douleur au flanc | 3 | douleur | `douleur-au-flanc-1-img{1..3}.jpg` |
| RESCOS-32 - Douleur oculaire | 1 | oeil | `oeil-rouge-img1.jpg` |
| RESCOS-34 - Douleur thoracique | 2 | douleur | `douleur-thoracique-1-img{1,2}.jpg` |
| RESCOS-35 - Douleur thoracique | 3 | douleur | `douleur-thoracique-2-img{1..3}.jpg` |
| RESCOS-41 - Dysurie | 3 | dysurie | `dysurie-2-img{1..3}.jpg` |
| RESCOS-44 - Fatigue | 2 | fatigue | `fatigue-1-img{1,2}.jpg` |
| RESCOS-48 - Lombalgie | 2 | douleur | `douleur-dorsale-1-img{1,2}.jpg` |
| RESCOS-50 - Malaise | 1 | syncope | `syncope-1-img1.jpg` |
| RESCOS-5 - AVP | 3 | urgence | `urgence-1-img{1..3}.jpg` |
| **Total** | **26** | | **12 stations** |

**Statut J4ter (2026-05-05)** : ces 26 images ont été migrées vers leurs 12
stations RESCOS d'origine via le fallback `filename → basename → slug → lookup
disque` ajouté dans
[scripts/migrate-pedagogical-content.ts](../scripts/migrate-pedagogical-content.ts)
(branche conditionnée par `typeof img.data !== "string" && typeof img.filename === "string"`).
Chaque entrée migrée porte le marqueur additif `source: "legacy-filename"` et
expose un champ `data` au format `/pedagogical-images/<slug>.jpg` conforme à
l'invariant I16. Le rapport
[docs/phase-11-migration-report.json](phase-11-migration-report.json) acte
`imagesRecoveredTotal: 26` et `mapped[].imagesRecovered` ventilé par station.

### Découverte J4ter — 5 stations supplémentaires hors scope (11 entrées)

Le run J4ter a détecté 11 entrées legacy supplémentaires sur 5 stations dont les
filenames source utilisent des accents non normalisés vs. les noms ASCII sur
disque. L'audit J4 ([docs/phase-12-orphans-audit.md](phase-12-orphans-audit.md))
n'a pas relié les deux variantes : il cherchait par stem ASCII parmi les
fichiers présents sur disque, sans tester la version accentuée référencée par
le `filename` source.

| Station | Imgs | Filename source (accent) | Fichier disque (ASCII) | État |
|---|---|---|---|---|
| RESCOS-14 — Diarrhées | 2 | `diarrhées-1-img{1,2}.jpg` | `diarrhees-1-img{1,2}.jpg` | en corbeille J4bis (restaurable) |
| RESCOS-33 — ECC Gynécologique | 5 | `ecc_gynéco-img{1..5}.jpg` | `ecc_gyneco-img{1..5}.jpg` | en corbeille J4bis (restaurable) |
| RESCOS-45 — Fatigue | 1 | `dépression-1-img1.jpg` | `depression-1-img1.jpg` | en corbeille J4bis (restaurable) |
| RESCOS-47 — Ictère | 2 | `ictère-1-img{1,2}.jpg` | `ictere-1-img{1,2}.jpg` | en corbeille J4bis (restaurable) |
| RESCOS-68 — Eruption cutanée | 1 | `rescos-68-zona-thoracique.jpg` | (introuvable) | dette définitive |
| **Total** | **11** | | | **10 récupérables, 1 perdu** |

**Effet visible dans le rapport** : `imagesMissingOnDisk` passe de 0 (post-J3)
à 11 (post-J4ter) — visibilité de la découverte, non régression fonctionnelle.

**Décisions Phase 12 (Q-P12-A-15 = (1), Q-P12-A-15b = (α))** :

- **4 stations restaurables (10 images)** — RESCOS-14, RESCOS-33, RESCOS-45,
  RESCOS-47 — reportées en **J4quater** : extension du fallback avec
  normalisation diacritique (`removeDiacritics(basename)`) et restauration
  préalable des 10 fichiers ASCII depuis `tmp/phase-12-orphans-deleted/` vers
  `client/public/pedagogical-images/` via `git mv` inverse. Hors scope J4ter
  pour respecter l'invariant « périmètre strict » et éviter de mélanger deux
  problématiques distinctes (migration legacy filename simple vs. résolution
  drift accent/non-accent).

- **RESCOS-68 (1 image, dette définitive)** — l'image
  `rescos-68-zona-thoracique.jpg` est introuvable :
  - absente de [client/public/pedagogical-images/](../client/public/pedagogical-images/)
  - absente de [tmp/phase-12-orphans-deleted/](../tmp/phase-12-orphans-deleted/) (corbeille J4bis)
  - absente de tout autre emplacement pédagogique connu du dépôt

  La station RESCOS-68 reste **partiellement enrichie sans iconographie**
  (les autres champs `pedagogicalContent` — `resume` / `presentationPatient` /
  `theoriePratique` — ont été migrés normalement en J3, seul le bloc images
  pédagogiques manque). Aucune action future possible sans ré-acquisition
  externe du fichier source.
