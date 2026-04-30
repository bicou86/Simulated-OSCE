# Phase 7 — Bilan de clôture

> Phase d'extension du périmètre médico-légal CH (lexique v1.0.0 → v1.1.0)
> et d'introduction du 6e axe `medico_legal` au scoring global pondéré.
> Ce document fige l'état du corpus à la fin de Phase 7, consolide les
> arbitrages process des 4 jours de dev (J1→J4) et identifie la dette
> reportée Phase 8.

- **Période** : 2026-04-29 (J1 ⟶ J5, journée unique compressée)
- **Branche** : `phase-7-medico-legal-extension`
- **PR cible** : `#6` (squash merge → `main`), à créer en J5
- **Parent main** : commit Phase 6 = `bea866d`

## Sommaire

1. [Cadrage initial — 5 arbitrages utilisateur](#1-cadrage-initial)
2. [Récap 4 jours de dev (J1 → J4)](#2-récap-4-jours-de-dev)
3. [Métriques tests](#3-métriques-tests)
4. [Invariants Phase 7](#4-invariants-phase-7)
5. [Décisions process documentées](#5-décisions-process-documentées)
6. [Dette technique reportée Phase 8](#6-dette-technique-reportée-phase-8)
7. [Métriques de couverture corpus](#7-métriques-de-couverture-corpus)
8. [Vérifications runtime Claude Chrome](#8-vérifications-runtime-claude-chrome)
9. [Préparation PR #6 — description prête à coller](#9-préparation-pr-6)

---

## 1. Cadrage initial

5 arbitrages utilisateur fixés en début de Phase 7 :

| # | Sujet | Décision | Statut |
|---|---|---|---|
| 1 | Scope lexique J1 | 4 nouvelles catégories CH ajoutées (violence_sexuelle_adulte, capacite_discernement, directives_anticipees, responsabilite_teleconsult) | ✅ J1 |
| 2 | Poids 6e axe J2 | 10 % (rééquilibrage proportionnel × 0.9 sur les 5 axes existants quand actif) | ✅ J2 |
| 3 | 2e tour relecture corpus | NON — USMLE-9 seul traité, reste reporté Phase 8 | ✅ J3 |
| 4 | Format 5 jours | Validé (J1 dev lexique / J2 scoring / J3 annotation+debug / J4 UI+harmonisation / J5 bilan+PR) | ✅ J5 |
| 5 | Harmonisation settings | OUI en J4, valeur cible canonique « Cabinet de médecine générale » | ✅ J4 |

## 2. Récap 4 jours de dev

### J1 — `8764ffa` Extension lexique médico-légal CH v1.0.0 → v1.1.0

- **Sujet** : enrichissement de l'enum `legalCategorySchema` Zod (+4 catégories CH) et de `LEGAL_LEXICON` (+22 entrées must_verbalize / must_avoid couvrant les 4 nouvelles catégories) ; bump `LEGAL_LEXICON_VERSION` `"1.0.0"` → `"1.1.0"`.
- **Tests** : baseline 745 → **1151** (+406 vs Phase 6 fin = 1037 + 114 vs J0 P7 ; les +406 incluent la suite J1.0.1 de tests lexique v1.1.0 dédiés).
- **Invariant levé** : « Lexique fermé v1.0.0 » → bump v1.1.0 (additif strict, 9 valeurs enum, dont 7 avec couverture lexicon pattern).
- **Invariants maintenus** : ZÉRO LLM, schéma additif, briefs HTTP byte-à-byte, ZÉRO modif scoring 5 axes (encore valable jusqu'à J2).
- **Dette J1** : 5 catégories enum sans couverture pattern complète (à terme Phase 8 si nouveau corpus).

### J2 — `70b65a0` 6e axe medico_legal pondéré 10 % + rééquilibrage proportionnel × 0.9

- **Sujet** : ajout du 6e axe `medico_legal` au scoring global, ACTIVÉ uniquement quand la station porte un `legalContext`. Rééquilibrage proportionnel : chaque axe v1 multiplié par 0.9, `medico_legal` reçoit 10 → somme = 100. Source du score : agrégation moyenne uniforme des 4 sous-axes legalEvaluator. ZÉRO LLM ajouté.
- **Tests** : 1151 → **1184** (+33).
- **Invariant LEVÉ** : « ZÉRO modif scoring 5-axes » (Phase 5/6) → désormais 6 axes pondérés. Compensé par invariant byte-à-byte sur stations sans `legalContext` (≥282 stations) prouvé via Test A snapshot non-régression.
- **Invariants maintenus** : tous les autres ; lexique v1.1.0 inchangé ; briefs HTTP inchangés (pondération est côté evaluator output, pas dans le brief).
- **Process** : substitution silencieuse RESCOS-70 → mea culpa documenté J3 (cf. §5).

### J3 — `45d301f` Annotation USMLE-9 + correctif RESCOS-70 + endpoint debug poids

- **Sujet 1** : annotation `legalContext` sur USMLE-9 (catégorie `violence_sexuelle_adulte`, decision `refer`, mandatory_reporting `false`, applicable_law minimaliste `[CP-321, LAVI-art-1, CDM-FMH-art-34]`) — **dernière station status C non-flagged du corpus** désormais couverte.
- **Sujet 2** : Test A étendu de 5 à 6 stations témoins (RESCOS-70 réintégrée, mea culpa J2 documenté).
- **Sujet 3** : endpoint debug `GET /api/debug/evaluation-weights?stationId=X` — outil dev-only avec garde NODE_ENV=production → 404. Côté code uniquement (le câblage runtime se révèlera défaillant côté Replit en J4 — caveat tsx watch).
- **Tests** : 1184 → **1197** (+13).
- **Invariant levé** : aucun.
- **Invariants maintenus** : tous (additif strict prouvé : 1 seule station dans le corpus consomme `violence_sexuelle_adulte`).
- **Couverture corpus** : 287/287 medicoLegalReviewed (était 286/287), 5/287 legalContext (était 4/287).

### J4 — `9b420b0` Harmonisation settings + UI Evaluation 6e ligne medico_legal + tests intégration debug router

- **Sujet 1** : diagnostic du 404 runtime J3 sur l'endpoint debug → cause racine = caveat `tsx watch` (kill complet Replit nécessaire après ajout de router). Pas un bug code. 5 tests d'intégration end-to-end ajoutés pour verrouiller le mount à l'avenir.
- **Sujet 2** : harmonisation settings — 4 variantes → « Cabinet de médecine générale » (70 stations affectées) via regex string-level (préservation formatting). 1 station legal touchée : USMLE-34 (brief 525 → 540 bytes, baseline actée option A).
- **Sujet 3** : UI Evaluation — 6e ligne `Médico-légal` conditionnelle (rendue ssi `medicoLegalScore` + `medicoLegalWeight` définis côté backend). 4 tests composant ajoutés.
- **Tests** : 1197 → **1211** (+14).
- **Invariant levé** : aucun (USMLE-34 byte count change = cas explicite acté option A, nouveau baseline 540 bytes).
- **Invariants maintenus** : 5 axes Phase 5/6 inchangés visuellement, briefs HTTP des 4 autres stations legal inchangés.

## 3. Métriques tests

| Étape          | Pass     | Delta vs précédent |
|----------------|---------:|-------------------:|
| Baseline P4    |      745 |                  — |
| Phase 5 fin    |      956 |               +211 |
| Phase 6 fin    |     1037 |                +81 |
| Phase 7 J1     |     1151 |               +114 |
| Phase 7 J2     |     1184 |                +33 |
| Phase 7 J3     |     1197 |                +13 |
| Phase 7 J4     |     1211 |                +14 |
| **Phase 7 J5** | **1211** | **0** (clôture)    |

**Delta Phase 7 vs Phase 6** : +174 tests (1211 vs 1037).

12 tests skipped (gated derrière `RUN_LLM_INTEGRATION=1` env var, intégration Anthropic/OpenAI réelle ; non-bloquants pour la CI déterministe).

## 4. Invariants Phase 7

| Invariant | Statut | Détail |
|---|---|---|
| Schéma additif strict (jamais rename ni suppression de champ existant) | **MAINTENU** | Chaque ajout (catégorie, axe, champ) est additif. Tests `phase7J3 invariant additif strict` + `EVALUATION_AXES_6.slice(0, 5) === EVALUATION_AXES`. |
| ZÉRO LLM dans heuristiques (legalEvaluator, scoring, debug router) | **MAINTENU** | Aucune nouvelle dépendance OpenAI/Anthropic ajoutée Phase 7. Vérifié via `npm ls` (no diff) + grep imports dans les fichiers J2/J3/J4. |
| Briefs HTTP byte-à-byte si pas de legalContext | **MAINTENU** | Convention fixée J4 : `Buffer.byteLength(json, 'utf-8')`. Tests `phase6CorpusAudit` (287 briefs, aucun leak medico-légal) toujours verts. |
| ZÉRO modif scoring 5-axes (Phase 5/6) | **LEVÉ J2** | Passage à 6 axes pondérés. medico_legal=0 si pas de legalContext (axe inactif, byte-à-byte préservé sur les 282 stations sans qualif). medico_legal=10 + rééquilibrage proportionnel × 0.9 sinon. |
| Lexique fermé v1.0.0 (Phase 5/6) | **LEVÉ J1** | Bump v1.1.0. +4 catégories enum, +22 entrées lexicon pattern. Additif strict (les 5 valeurs Phase 5 maintenues). |
| Briefs HTTP byte-à-byte si station legal | **MAINTENU sauf USMLE-34** | 4/5 stations inchangées (528/717/513/509). USMLE-34 = 540 (était 525) après harmonisation setting J4 — option A actée. |
| `lexiconVersion` exposé `/api/evaluation/legal` = v1.1.0 | **MAINTENU** | Tests `legalLexicon.v1.1.0.test.ts` + `phase7J3.test.ts evaluateLegal({USMLE-9}).lexiconVersion === "1.1.0"`. |
| Endpoint debug 404 en production | **MAINTENU** | Test J3 + J4 `NODE_ENV=production → 404 indistinguable d'une route absente`. |

## 5. Décisions process documentées

### J1 — Lexique v1.1.0 (additif)

- **9 valeurs enum** (5 Phase 5 + 4 nouvelles CH). Toute future catégorie en Phase 8+ est un autre bump (v1.2.0+), jamais une mutation rétroactive.
- **7/9 catégories avec couverture pattern lexicon** (les 2 réservées Phase 5 — `signalement_danger_tiers`, `declaration_obligatoire` — restent enum-only, à équiper pattern si demande pédagogique future).

### J2 — Option proportionnelle ×0.9 pour le rééquilibrage 5 axes

- **Choix** : option a) proportionnelle. Chaque axe v1 multiplié par 0.9, `medico_legal` reçoit 10. Somme = 100.
- **Justification** : préserve les ratios cliniques relatifs entre les 5 axes (ex. BBN garde sa dominance Communication 40 → 36 ; anamnese_examen garde l'équipondération 25 → 22.5).
- **Alternative rejetée** : option b) fixe (chaque axe v1 perd 2 points uniformément) — déformerait les profils déjà calibrés.
- **Précision** : floats IEEE 754 acceptés (22.5, 13.5, etc.). Math.round uniquement au globalScore final.

### J2 — Mea culpa substitution silencieuse RESCOS-70 (corrigé J3)

- En J2, RESCOS-70 a été substituée par RESCOS-7 dans Test A sous prétexte d'inexistence dans le corpus. **Faux négatif** : `stations_index.json` (legacy) ne la listait pas, mais `Patient_RESCOS_4.json:5075` la contient effectivement.
- **Process appliqué désormais** : ne plus jamais conclure « ID inexistant » sur la base d'un grep dans un fichier d'index. Toujours vérifier via `getStationMeta(id)` après `initCatalog()` AVANT toute substitution. Si `getStationMeta` renvoie `undefined`, **lever la main** plutôt que substituer.
- **Correctif J3** : RESCOS-70 réintégrée comme 4e station témoin Test A (anamnese_examen, snapshot=78), avec RESCOS-7 et USMLE-8 conservées comme couverture additionnelle.

### J3 — Pondération interne 4 sous-axes legal

- **Choix** : uniforme 25 % chacun (reconnaissance, verbalisation, decision, communication).
- **Justification** : chacun des 4 axes couvre une dimension distincte mais ÉGALEMENT critique du raisonnement médico-légal. Reconnaître le red flag sans verbaliser, sans décider correctement, ou sans communiquer correctement = échec pédagogique.
- **À recalibrer Phase 8+** si un signal clinique différenciateur émerge.

### J3 — `applicable_law` USMLE-9 minimaliste

- **Codes cités** : `CP-321` (secret pro qui PROTÈGE la patiente), `LAVI-art-1` (orientation aide aux victimes), `CDM-FMH-art-34` (déontologie professionnelle).
- **Codes NON cités délibérément** : CP-189 (contrainte sexuelle), CP-190 (viol), CP-191 (actes sur incapable). Raisons :
  - Codes prosécutoriaux, pas médicaux. Le médecin oriente, il ne se positionne pas sur la qualification pénale.
  - Les ajouter exigerait d'étendre `LEGAL_LAW_CODE_PATTERNS` (sinon le boot guard `validateLegalContextLawCodes` throw).
  - Le cadre médical est suffisant pour le scoring pédagogique attendu sur cette station.

### J4 — Convention byte count UTF-8

- **Standard fixé** : `Buffer.byteLength(json, 'utf-8')` pour toutes les vérifications de stabilité brief HTTP, Phase 8+.
- **Pourquoi** : J1→J3 ont oscillé entre `string.length` (UTF-16 char count) et `wc -c` (UTF-8 bytes). Différentiel ~4-15 bytes selon le nombre d'accents français. Convention UTF-8 byteLength est l'unité physique réelle du transport HTTP.
- **Baselines actées J4** : AMBOSS-24=528, USMLE-34=540, RESCOS-72=717, USMLE Triage 39=513, USMLE-9=509.

### J4 — Option A actée pour USMLE-34 (nouvelle baseline 540)

- **Choix** : harmonisation `"Cabinet médical"` → `"Cabinet de médecine générale"` étendue à USMLE-34 (option A par défaut).
- **Alternative B rejetée** : revertir USMLE-34 spécifiquement → laisserait une station legal avec un setting non-canonique au milieu d'un corpus harmonisé. Perte de cohérence > impact baseline.
- **Impact** : brief HTTP USMLE-34 525 → 540 bytes. Documenté ici comme nouvelle baseline.

### J4 — Hot-reload Replit caveat

- **`tsx watch` ne hot-reload PAS l'ajout de** : (a) nouveau fichier router, (b) modif `routes.ts`, (c) nouvelle fixture `Patient_*.json`, (d) modifs profondes `server/services/*`.
- **Process à appliquer** : kill complet du workflow Replit (Stop → Run via panneau workflows) après chaque commit Phase 8 touchant ces fichiers, AVANT tout test runtime UI ou Claude Chrome. Pas Ctrl+C — kill workflow.

## 6. Dette technique reportée Phase 8

| # | Item | Impact | Origine |
|---|---|---|---|
| 1 | RESCOS-72 sans grille évaluateur Sonnet (`Examinateur_RESCOS_4.json` s'arrête à RESCOS-71) | Bloque `runEvaluation` end-to-end sur cette station ; J2 Test B couvre via `evaluateLegal + aggregateMedicoLegalScore` isolés | Phase 5 J1 |
| 2 | Drill-down sous-axes legal dans UI Evaluation (4 axes : reconnaissance / verbalisation / decision / communication) + lien vers `LegalDebriefPanel` | Scope J4 minimal validé user (option B reportée) ; UI actuelle expose 1 ligne agrégée | Phase 7 J4 |
| 3 | Pondération interne 4 sous-axes legal — actuellement uniforme 25 % | À recalibrer si signal clinique différenciateur émerge | Phase 7 J3 |
| 4 | Variantes settings ambiguës non harmonisées (médecine de famille / remplacement / médecine des voyages / zone rurale / Consultation médicale / settings hospitaliers / cabinets spécialisés) | Décisions case-by-case Phase 8+ | Phase 7 J4 |
| 5 | 282 stations medicoLegalReviewed sans `legalContext` — 2e tour relecture | Couverture lexicon v1.1.0 = 1 seule annotation USMLE-9 ; potentiel d'extension si besoin pédagogique | Arbitrage user Phase 7 |
| 6 | 2 catégories enum sans couverture pattern (`signalement_danger_tiers`, `declaration_obligatoire`) | Réservées Phase 5, jamais consommées par le corpus, à équiper si station ad hoc Phase 8+ | Phase 5 J1 (réservation) |
| 7 | tsc warnings legacy `legalLexicon.ts` lignes 340-341 (regex `/u` flag, target ES5) + ligne 1011 (Set iteration, downlevelIteration) | Non-bloquant runtime, Phase 5 + Phase 7 J1 | tsc target tsconfig.json |
| 8 | Phase 2 byte-stability checksum — convention de mise à jour explicite à formaliser (J4 a regen manuellement via script ad-hoc) | Risque de drift silencieux | Phase 3 J4 |
| 9 | LEGAL_LAW_CODE_PATTERNS ne couvre pas CP-189/190/191 — bloquerait toute future annotation Phase 8 qui voudrait citer ces codes prosécutoriaux | Rare en contexte médical, mais à anticiper si station policière/médico-judiciaire spécifique | Phase 7 J3 |

## 7. Métriques de couverture corpus

| Métrique | Valeur | Note |
|---|---|---|
| Total stations uniques (dédup shortId) | **287** | RESCOS-64 doublon hérité Phase 4 compté une seule fois |
| Stations avec `legalContext` | **5/287** (1.7 %) | AMBOSS-24, USMLE-34, RESCOS-72, USMLE Triage 39, USMLE-9 |
| Stations avec `medicoLegalReviewed=true` | **287/287** (100 %) | Couverture complète post-J3 |
| Catégories enum v1.1.0 | **9** | secret_pro_levee, signalement_maltraitance, certificat_complaisance, signalement_danger_tiers (réservée), declaration_obligatoire (réservée), violence_sexuelle_adulte, capacite_discernement, directives_anticipees, responsabilite_teleconsult |
| Catégories effectivement consommées | **4/9** (44 %) | secret_pro_levee, signalement_maltraitance, certificat_complaisance, violence_sexuelle_adulte. Les 4 nouvelles CH sont disponibles mais non consommées hors USMLE-9. |
| Catégories avec couverture lexicon pattern | **7/9** (78 %) | Les 2 réservées Phase 5 (signalement_danger_tiers, declaration_obligatoire) restent enum-only |
| Setting canonique « Cabinet de médecine générale » | **143/287** (50 %) | 73 historique + 70 harmonisées J4 |
| `unmapped` items dans legalContext | **0** | Tous les `candidate_must_verbalize` / `candidate_must_avoid` matchent le lexique runtime (test J3 verrouille) |

## 8. Vérifications runtime Claude Chrome

| Jour | Hash | Statut runtime UI | Notes |
|---|---|---|---|
| J1 | `8764ffa` | ✅ PASS | Endpoint `/api/evaluation/legal` retourne `lexiconVersion: "1.1.0"`. 7 catégories effectives runtime. |
| J2 | `70b65a0` | ✅ PASS | `result.medicoLegalScore` + `medicoLegalWeight` exposés sur 5 stations legal (sauf RESCOS-72 = gap data). Formule `score_new ≈ score_old × 0.9 + ml × 0.1` validée ±1pt sur AMBOSS-24/USMLE-34/USMLE Triage 39 via runEvaluation pipeline complet. |
| J3 | `45d301f` | ⚠ PASS partiel | Endpoint `/api/debug/evaluation-weights` 404 runtime initial → cause = `tsx watch` no-reload → fix process documenté J4. Code mount valide. |
| J4 | `9b420b0` | ✅ PASS (post kill workflow) | 5 cas debug endpoint OK, UI 6e ligne medico_legal présente sur stations legal, harmonisation settings reflétée dans station picker. USMLE-34 brief = 540 bytes UTF-8 validé. |

## 9. Préparation PR #6

**Titre** : `Phase 7 — Extension médico-légale CH v1.1.0 + 6e axe scoring pondéré + UI 6-axes`

**Base branch** : `main`

**Compare branch** : `phase-7-medico-legal-extension`

**Mode** : **squash merge** (cohérent avec PR #3 Phase 4, #4 Phase 5, #5 Phase 6)

**Description prête à coller** :

```markdown
## Phase 7 — Extension médico-légale CH v1.1.0 + 6e axe scoring pondéré + UI 6-axes

Bilan complet : [`docs/phase-7-bilan.md`](docs/phase-7-bilan.md)

### 4 commits J1 → J4

| Jour | Hash | Sujet |
|---|---|---|
| J1 | `8764ffa` | Extension lexique CH v1.0.0 → v1.1.0 (4 catégories, 9 enum Zod, +22 entrées lexicon pattern) |
| J2 | `70b65a0` | 6e axe `medico_legal` pondéré 10 % + rééquilibrage proportionnel × 0.9 |
| J3 | `45d301f` | Annotation USMLE-9 (violence_sexuelle_adulte) + correctif RESCOS-70 + endpoint debug `/api/debug/evaluation-weights` |
| J4 | `9b420b0` | Harmonisation settings (70 stations → "Cabinet de médecine générale") + UI Evaluation 6e ligne `medico_legal` + tests intégration debug router |

### 5 arbitrages utilisateur actés

1. Scope lexique J1 : +4 catégories CH (violence_sexuelle_adulte, capacite_discernement, directives_anticipees, responsabilite_teleconsult)
2. Poids 6e axe J2 : 10 % + rééquilibrage proportionnel × 0.9 sur les 5 axes existants
3. Pas de 2e tour relecture corpus J3 → USMLE-9 seul, reste reporté Phase 8
4. Format 5 jours validé
5. Harmonisation settings J4 → valeur cible « Cabinet de médecine générale »

### Invariants levés (avec justification)

- **« ZÉRO modif scoring 5-axes »** (J2) → passage à 6 axes pondérés. Justifié par ajout du 6e axe medico_legal additif. Compensé par invariant byte-à-byte sur stations sans `legalContext` (≥282 stations) prouvé via Test A snapshot non-régression (6 stations témoins).
- **« Lexique fermé v1.0.0 »** (J1) → bump v1.1.0. Justifié par 4 nouvelles catégories CH nécessaires pour qualifier USMLE-9 (violence_sexuelle_adulte) + couvrir le périmètre pédagogique CH étendu. Additif strict — les 5 valeurs Phase 5 sont maintenues.

### Métriques tests

- Phase 6 fin : 1037 pass
- **Phase 7 fin : 1211 pass** (+174 vs Phase 6)
- 12 skipped (tests d'intégration LLM gated `RUN_LLM_INTEGRATION=1`, non-bloquants)

### Nouveaux fichiers majeurs

- `server/__tests__/phase7J2SixthAxis.test.ts` — 34 tests scoring 6 axes (Tests A, B, C, D + bonus formule)
- `server/__tests__/phase7J3.test.ts` — 12 tests annotation USMLE-9 + endpoint debug + invariant additif
- `server/__tests__/phase7J4DebugRouterMount.test.ts` — 5 tests intégration end-to-end debug router
- `server/__tests__/phase7J4SettingsHarmonization.test.ts` — 5 tests audit harmonisation settings
- `server/routes/debug.ts` — endpoint `/api/debug/evaluation-weights` (dev-only, 404 en prod)
- `docs/phase-7-bilan.md` — bilan de clôture (ce document)

### Modifications majeures

- `shared/evaluation-weights.ts` (+96) — `EvaluationAxis6`, `AxisWeights6`, `getEffectiveAxisWeights(stationType, hasLegalContext)`
- `server/services/evaluatorService.ts` (+128 / -8) — détection `legalContext`, `aggregateMedicoLegalScore`, sortie `result.medicoLegalScore` + `medicoLegalWeight`
- `server/lib/legalLexicon.ts` (+596) — extension v1.1.0 (4 catégories, 22 entrées pattern, +3 codes lois LAVI/CDM/CO)
- `client/src/pages/Evaluation.tsx` (+26) + `client/src/lib/api.ts` (+11) — 6e ligne UI conditionnelle
- `server/data/patient/Patient_*.json` (+71 lignes net) — annotation USMLE-9 + harmonisation 70 settings
- `server/routes.ts` (+21) — mount router debug + comment ordre de mount

### Vérifications runtime Claude Chrome

| Jour | Hash | Statut |
|---|---|---|
| J1 | `8764ffa` | ✅ PASS — `lexiconVersion=1.1.0` runtime |
| J2 | `70b65a0` | ✅ PASS — formule `score_new ≈ score_old × 0.9 + ml × 0.1` validée ±1pt sur 3 stations legal |
| J3 | `45d301f` | ⚠ PASS partiel — endpoint debug 404 initial = caveat `tsx watch`, fix process documenté J4 |
| J4 | `9b420b0` | ✅ PASS — 5 cas debug endpoint, UI 6e ligne, harmonisation settings reflétée |

### Dette Phase 8

Voir [`docs/phase-7-bilan.md` §6](docs/phase-7-bilan.md). 9 items identifiés, dont notamment :
- RESCOS-72 sans grille évaluateur Sonnet (gap data hérité Phase 5)
- Drill-down sous-axes legal dans UI (option B scope J4 reportée)
- Pondération interne 4 sous-axes legal (uniforme 25 %, à recalibrer)
- 282 stations medicoLegalReviewed sans legalContext (2e tour relecture)
- 3 tsc warnings legacy `legalLexicon.ts` (regex /u flag + Set iteration)

### Convention byte count UTF-8 (Phase 8+)

Standard fixé J4 : `Buffer.byteLength(json, 'utf-8')` pour toutes les vérifications de stabilité brief HTTP. Baselines actées :

| Station | Bytes UTF-8 |
|---|---:|
| AMBOSS-24 | 528 |
| **USMLE-34** | **540** (était 525, harmonisation setting J4 — option A) |
| RESCOS-72 | 717 |
| USMLE Triage 39 | 513 |
| USMLE-9 | 509 |

### Pièges & rappels post-merge

- ⚠ **Replit hot-reload** : kill complet du workflow (Stop → Run, pas Ctrl+C) après pull du squash sur `main` — le merge introduit nouveau router debug + nouvelle fixture USMLE-9 + composant React modifié, tous les 4 sont des cas où `tsx watch` ne hot-reload pas profondément.
- ⚠ **Endpoint debug 404 en production** : invariant maintenu, testé. NE PAS lever en prod sans revue sécurité (poids station ≠ secret, mais surface API minimisée par design).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
