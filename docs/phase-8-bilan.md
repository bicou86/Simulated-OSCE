# Phase 8 — Bilan de clôture

> Phase d'introduction des **stations doubles** (modèle 2 — stations
> séparées liées via `parentStationId`), avec endpoint dédié
> `/api/evaluation/presentation` pour le scoring 4-axes 25 % de la
> partie 2, fermeture de la dette Phase 5 J1 (grille évaluateur
> RESCOS-72), et hotfix runtime du mapping `not_found` → 404.

- **Période** : 2026-04-30 (J1 ⟶ J5, format 5 jours validé)
- **Branche** : `phase-8-stations-doubles`
- **PR cible** : `#7` (squash merge → `main`), description prête à coller dans [`docs/phase-8-pr-description.md`](./phase-8-pr-description.md)
- **Parent main** : commit Phase 7 = `e4c75be`

## Sommaire

1. [Résumé exécutif](#1-résumé-exécutif)
2. [Cadrage initial — 6 arbitrages utilisateur](#2-cadrage-initial)
3. [Chronologie J1 → J5](#3-chronologie-j1-j5)
4. [Invariants Phase 8 prouvés](#4-invariants-phase-8-prouvés)
5. [État corpus post-Phase 8](#5-état-corpus-post-phase-8)
6. [Couverture tests](#6-couverture-tests)
7. [Mini sondage 282 stations sans legalContext](#7-mini-sondage-282-stations-sans-legalcontext)
8. [Conventions Phase 8 actées (référence Phase 9+)](#8-conventions-phase-8-actées)
9. [Dette technique reportée Phase 9](#9-dette-technique-reportée-phase-9)
10. [Vérifications runtime Claude Chrome](#10-vérifications-runtime-claude-chrome)

---

## 1. Résumé exécutif

Phase 8 livre une architecture **additive stricte** pour les stations
doubles ECOS suisses (consultation patient simulé + présentation orale
au spécialiste, illustrée par le seul cas du corpus actuel : RESCOS-64
toux/hémoptysie). L'invariant clé est qu'**aucune des 287 stations
historiques n'est régressée byte-à-byte** : les 5 baselines briefs Phase 7
(528/540/717/513/509) restent stables, le shortId historique
« RESCOS-64 » continue de pointer vers la partie 1 (647 bytes UTF-8
préservés), et le scoring 6-axes / lexique v1.1.0 / endpoint
`/api/evaluation/legal` ne sont pas touchés. La nouvelle station
RESCOS-64-P2 (partie 2) est indexée distinctement dans le catalog
(288 = 287 + 1) via une exception ciblée du pattern `extractShortId`,
et son scoring est isolé dans un endpoint séparé `/api/evaluation/presentation`
heuristique pure (zéro LLM dans la décision finale). En parallèle,
la dette Phase 5 J1 (grille évaluateur RESCOS-72 absente) est **fermée**
avec une grille 5 axes / 20 items rédigée par l'utilisateur (validation
médicale experte requise pour invention pédagogique).

## 2. Cadrage initial

6 arbitrages utilisateur fixés en début de Phase 8 :

| # | Arbitrage | Décision | Livré |
|---|---|---|---|
| A | Format 5 jours | Validé | ✅ J1 → J5 |
| B | Sondage corpus stations doubles | OUI en J1, audit puis arbitrage utilisateur mid-J1 | ✅ J1 (1 paire détectée : RESCOS-64) |
| C | Modèle architectural | **Modèle 2** — stations séparées liées via `parentStationId` optionnel | ✅ J1 schéma + J2 fixture |
| D | Scoring partie 2 | **Grille séparée 4 axes 25 %** isolée du scoring 6-axes (jamais agrégée) | ✅ J3 endpoint `/api/evaluation/presentation` |
| E | RESCOS-72 grille évaluateur | Phase 8 J4 (fermeture dette Phase 5 J1) | ✅ J4 grille 5 axes / 20 items intégrée |
| F | Item 5 dette Phase 7 (282 stations sans legalContext) | Mini sondage seulement, pas d'extension corpus | ✅ J5 audit + rapport [`docs/phase-8-audit-282-stations.md`](./phase-8-audit-282-stations.md) |

## 3. Chronologie J1 → J5

| Jour | Hash | Sujet et livrables |
|---|---|---|
| **J1** | `8b6ad51` | Audit corpus stations doubles (1 paire détectée : RESCOS-64). Schéma Zod additif optionnel `parentStationId: z.string().min(1).optional()` dans [`shared/station-schema.ts`](../shared/station-schema.ts). Validation référentielle two-pass dans [`server/services/stationsService.ts`](../server/services/stationsService.ts) (`checkParentStationIdReferences` exposé via `__test__`). 10 nouveaux tests, 1211 → 1221 pass. |
| **J2** | `7aa4210` | Fixture RESCOS-64-P2 complétée dans [`server/data/patient/Patient_RESCOS_4.json`](../server/data/patient/Patient_RESCOS_4.json) (additif strict, partie 1 byte-à-byte intacte). `extractShortId` étendu avec exception ciblée `Station double 2$` → suffixe `-P2`. `parentStationId` ajouté à `META_FIELDS_TO_STRIP` (jamais leaké dans `/api/patient/:id/brief`). Snapshots `287 → 288` dans 5 fichiers tests. 22 nouveaux tests, 1221 → 1243 pass. Brief partie 2 = **362 bytes UTF-8** acté comme nouvelle baseline. |
| **J3** | `234d006` | Service [`server/services/presentationEvaluator.ts`](../server/services/presentationEvaluator.ts) (411 lignes, heuristique pure 3 modes : count + recalibration max + token + alias-binaire + skip silent). Endpoint `POST /api/evaluation/presentation` ajouté dans [`server/routes/evaluation.ts`](../server/routes/evaluation.ts). Arbitrages Phase A J3 résolus : β fractional (Ambiguïté A), B1 extraction diagnostic du `text` (Ambiguïté B), C3 skip silent r14 (Ambiguïté C). Détection asymétrie items_attendus vs scoringRule (p4/p5/p7) → recalibration max algorithmique. Détection format token-based (p3) → 3e mode parser. 50 nouveaux tests, 1243 → 1293 pass. |
| **J4** | `e6da90f` | Hotfix 404 → 500 sur `/api/evaluation/presentation` : ajout `not_found` à `ApiErrorCode` + mapping HTTP_BY_CODE → 404 dans [`server/lib/errors.ts`](../server/lib/errors.ts). Grille évaluateur RESCOS-72 intégrée dans [`server/data/evaluator/Examinateur_RESCOS_4.json`](../server/data/evaluator/Examinateur_RESCOS_4.json) après RESCOS-71 (additif strict, +255 lignes). Workflow validation experte respecté : Claude Code génère template vide ([`docs/phase-8-rescos-72-grille-template.json`](./phase-8-rescos-72-grille-template.json)), utilisateur (médecin) remplit ([`docs/phase-8-rescos-72-grille-filled.json`](./phase-8-rescos-72-grille-filled.json)), Claude Code intègre. 9 tests runtime `console.warn` formats inconnus scoringRule. 25 nouveaux tests, 1293 → 1318 pass. |
| **J5** | (commit J5 — bilan) | Mini sondage 282 stations sans legalContext via [`scripts/audit-282-stations-no-legal.ts`](../scripts/audit-282-stations-no-legal.ts) + rapport markdown [`docs/phase-8-audit-282-stations.md`](./phase-8-audit-282-stations.md). 13 tests script (lecture seule, idempotence, couverture 283 stations). Bilan ([`docs/phase-8-bilan.md`](./phase-8-bilan.md)). PR description prête à coller ([`docs/phase-8-pr-description.md`](./phase-8-pr-description.md)). Cleanup final. |

## 4. Invariants Phase 8 prouvés

| # | Invariant | Preuve |
|---|---|---|
| 1 | **Schéma additif strict** | Diff Phase 8 sur fixtures = +257 lignes (RESCOS-64-P2 partie 2 complétée + grille RESCOS-72), zéro suppression. Aucune modif `legalEvaluator.ts`, `evaluation-weights.ts`, scoring 6-axes, `lexicon`. |
| 2 | **Briefs HTTP byte-à-byte stables sur 7 stations** | 528 / 540 / 717 / 513 / 509 (Phase 7) + 647 (RESCOS-64 partie 1, baseline Chrome préservée) + **362 (RESCOS-64-P2 nouvelle baseline)**. Tests J2/J4 vérifient runtime via supertest + `Buffer.byteLength(json, 'utf-8')`. |
| 3 | **`parentStationId` jamais leaké dans `/api/patient/:id/brief`** | `META_FIELDS_TO_STRIP` étendu en J2 ([`server/services/patientService.ts:439`](../server/services/patientService.ts#L439)). Test J2 `expect(json).not.toContain("parentStationId")` sur 7 stations. |
| 4 | **Catalog 287 → 288 stations distinctes** | RESCOS-64-P2 indexée via `extractShortId` exception ciblée (`Station double 2$` → suffixe `-P2`). Tests J2 `listStations.length === 288`. |
| 5 | **`/api/evaluation/presentation` : 4 codes HTTP testés runtime** | 200 (RESCOS-64-P2 OK) / 400 (transcript vide ou stationId partie 1) / 400 (body sans stationId) / 404 (stationId inexistant + body.code='not_found' + body.error). Hotfix J4 corrige le drift 404 → 500. |
| 6 | **`/api/evaluation/legal` snapshot inchangé** sur 5 stations legal | Route POST `/legal` non touchée dans `evaluation.ts` (diff = uniquement commentaires + ajout route `/presentation`). Tests `legalEvaluator.test.ts` toujours pass. |
| 7 | **`/api/debug/evaluation-weights` opérationnel** | Test J4 RESCOS-72 retourne 6 axes pondérés Phase 7 J2 (`medico_legal=10`, `sumWeights=100`). Aucune modif router debug. |
| 8 | **`lexiconVersion v1.1.0` maintenu** | `server/lib/legalLexicon.ts` non touché en Phase 8. Test `evaluateLegal(RESCOS-72).lexiconVersion === "1.1.0"` ✅. |
| 9 | **Zéro LLM dans la décision finale** | `presentationEvaluator.ts` n'importe ni `openai` ni `@anthropic-ai/sdk`. Spy test J3 `evaluatePresentation N'INVOQUE PAS evaluateLegal`. Script audit J5 ne touche aucun service LLM. |
| 10 | **Grille RESCOS-72 conforme convention ECOS** | 5 axes (anamnese / examen / management / cloture / communication), 20 items, modes scoringRule observés = count-based + alias-binaire (pas de token, pas de format inconnu) — toutes les 10 scoringRules parsables sans warn. |

## 5. État corpus post-Phase 8

| Compteur | Phase 7 fin | Phase 8 fin | Delta |
|---|---|---|---|
| Stations physiques distinctes (catalog) | 287 | **288** | +1 (RESCOS-64-P2) |
| Stations avec `legalContext` | 5 | 5 | 0 |
| Stations avec `medicoLegalReviewed=true` | 287 | **288** | +1 (RESCOS-64-P2 cohérence) |
| Stations avec `parentStationId` | 0 | **1** | +1 (RESCOS-64-P2 → "RESCOS-64") |
| Paires doubles détectées | 0 | **1** | +1 (RESCOS-64) |
| Grilles évaluateur complètes | 287/288 (RESCOS-72 manquante) | **288/288** | dette Phase 5 J1 fermée |
| `lexiconVersion` | v1.1.0 | v1.1.0 | inchangé |

## 6. Couverture tests

| Étape | Pass | Skipped | Delta |
|---|---|---|---|
| Phase 7 final | 1211 | 12 | — |
| **Phase 8 J1** | 1221 | 12 | +10 |
| **Phase 8 J2** | 1243 | 12 | +22 |
| **Phase 8 J3** | 1293 | 12 | +50 |
| **Phase 8 J4** | 1318 | 12 | +25 |
| **Phase 8 J5** | **1331** | 12 | +13 (script audit) |
| **Cumulé Phase 8** | — | — | **+120 tests, 0 fail** |

Note J3 +50 dépasse la cible 12-22 du brief : couverture exhaustive des
helpers fins (`normalizeText`, `detectMention`, `extractDiagnostic`,
`splitCsvItems`, `parseScoringRule`, `applyScoringRule`) × 3 modes de
scoringRule. Acceptable car aucun fail et tests pertinents.

## 7. Mini sondage 282 stations sans legalContext

L'arbitrage F est livré sous forme de **script + rapport markdown**
([`scripts/audit-282-stations-no-legal.ts`](../scripts/audit-282-stations-no-legal.ts) +
[`docs/phase-8-audit-282-stations.md`](./phase-8-audit-282-stations.md)).
Heuristique pure réutilisant les `patterns` du lexique v1.1.0 sur le
texte aplati de **283 stations** (= 288 - 5 déjà annotées). 13 tests
de non-régression (lecture seule, idempotence, couverture).

**Distribution par catégorie** : `responsabilite_teleconsult` 120 hits
(42 % stations), `signalement_maltraitance` 107 (38 %),
`violence_sexuelle_adulte` 79 (28 %), `secret_pro_levee` 51 (18 %),
`capacite_discernement` 20 (7 %), `certificat_complaisance` 12 (4 %),
`directives_anticipees` 7 (2 %).

**Top 5 candidats par scoreTotal** : USMLE-6 (7), USMLE Triage 6 (6),
USMLE-18 (6), AMBOSS-28 (5), AMBOSS-34 (5).

⚠️ **Précision sémantique de l'audit = 0 %**. Les scores sont une
priorité d'**attention**, pas une recommandation d'annotation.
Décision Phase 9+ requerra validation experte humaine. Cf. §4 du
rapport pour les limites détaillées.

## 8. Conventions Phase 8 actées

À respecter en Phase 9+ et au-delà :

- **`parentStationId`** :
  - Strictement optionnel sur le schéma `stationSchema` ([`shared/station-schema.ts`](../shared/station-schema.ts)).
  - Valeur = **shortId** (pas fullId) de la station partie 1.
  - Validation référentielle au boot (post-init catalog two-pass) via `validateParentStationIds` dans [`server/services/stationsService.ts`](../server/services/stationsService.ts).
  - Toujours strippé du brief HTTP via `META_FIELDS_TO_STRIP`.
- **`extractShortId`** : pattern asymétrique. Partie 1 garde son shortId historique (préservation baselines HTTP). Partie 2 prend le suffixe `-P2` via exception ciblée `/Station double 2$/`. Pas de migration rétroactive — toute extension Phase 9+ sur le pattern doit préserver ce contrat.
- **`/api/evaluation/presentation`** : POST séparé du `/api/evaluation/legal`. Détection automatique partie 2 côté serveur via `parentStationId` du catalog. Body = `{ stationId, transcript }`. Codes HTTP : 200 / 400 (body invalide ou pas une partie 2) / 404 (stationId inexistant). Réponse expose `parentStationId` volontairement (transparence client).
- **`presentationEvaluator`** : zéro LLM. 3 modes scoringRule (count + recalibration max si `expected < ruleMax`, alias-binaire `Fait/±/Pas fait`, token-based fallback). Cas spéciaux : skip silent `["Aucun"]` (item r14), extraction diagnostic du `text` axe raisonnement (Ambiguïté B). Stopwords étendus + seuil keyword 60 %. `console.warn` dédupliqué une fois par item sur scoringRule unparsable.
- **`ApiErrorCode`** : `"not_found"` → 404 ajouté en J4. Tout nouvel endpoint qui retourne 404 doit utiliser `sendApiError(res, "not_found", ...)`, pas `res.status(404)` direct.

## 9. Dette technique reportée Phase 9

### 9.1 Dettes nouvelles Phase 8

| # | Origine | Item |
|---|---|---|
| 1 | J3 | **Recalibration max scoringRule** : actuellement quand items_attendus split CSV < ruleMax, le max est cappé sur la clause correspondante (p4/p5/p7 max=1 au lieu de 2). À raffiner si (i) cleanup fixture ajoutant les 2e éléments explicites avec validation médicale experte, ou (ii) LLM-assist autorisé pour détection sémantique fine du 2e élément libre. |
| 2 | J3 | **Format scoringRule token-based normalisation** : actuellement détecté par fallback heuristique (clause ni-Fait-ni-numérique → mode token). À normaliser si Phase 9+ étend le format scoringRule, p.ex. discriminant explicite `type: 'count' \| 'token' \| 'alias'` dans la fixture, ou format DSL structuré. Item p3 RESCOS-64-P2 = seul cas observé Phase 8. |
| 3 | J3 | **Détection négation transcript** dans `/api/evaluation/presentation` : heuristique actuelle ne distingue pas affirmation/négation (« pas de tuberculose » matche « Tuberculose » comme positif). Documenté + testé. À raffiner si LLM autorisé phase ultérieure. |
| 4 | J3 | **Évaluation r14 (« Aucun argument »)** dans `/api/evaluation/presentation` : actuellement skip silent (l'item ne contribue ni au score ni au max raisonnement, perte 6.25 % granularité 1/16 axe). À raffiner si LLM autorisé phase ultérieure (détection sémantique d'absence explicite verbalisée). |
| 5 | J2 | **Audit historique bloc `presentation` côté patient** : `Patient_RESCOS_4.json:3320-3447`, format object 14 entrées (p14 manquant) vs grille évaluateur array 15 entrées. Reste DORMANT et NON consommé par `/api/evaluation/presentation`. Décider cleanup ou normalisation après git blame archéologique. |

### 9.2 Dettes héritées Phase 7 §6 (toujours ouvertes)

| # | Origine | Item | Statut Phase 8 |
|---|---|---|---|
| 2 | Phase 7 J2 | Communication weight=0 sur stations type `triage` (cf. [`shared/evaluation-weights.ts`](../shared/evaluation-weights.ts) §3) | Inchangé |
| 3 | Phase 7 J3 | Catégories enum sans couverture lexique (`signalement_danger_tiers`, `declaration_obligatoire`) | Inchangé |
| 4 | Phase 7 J4 | Variantes settings ambiguës non harmonisées (médecine de famille, remplacement, médecine des voyages, zone rurale) | Inchangé |
| 7 | Phase 7 J4 | Mention RESCOS-64 doublon imprécise dans `docs/phase-7-bilan.md:176` | **Corrigée Phase 8** : RESCOS-64 = station double, pas doublon. Mise à jour effective dans le présent bilan. |
| 8 | Phase 7 J3 | 282 stations medicoLegalReviewed sans `legalContext` — extension corpus | Audit livré J5 (rapport `docs/phase-8-audit-282-stations.md`), décision étendre/pas-étendre = Phase 9+ |
| 9 | Phase 5 J1 | RESCOS-72 sans grille évaluateur Sonnet | **Fermée Phase 8 J4** ✅ |
| 10 | Phase 5 J3 | Flake intermittent `phase7J4SettingsHarmonization.test.ts` (race condition lecture `Patient_TEST_LEGAL_KO.json` créé/supprimé par `legalContextBootGuard.test.ts`) | Inchangé. Mes tests J1/J5 utilisent un filtre `!f.includes("TEST_LEGAL")` pour s'en prémunir individuellement. Fix global = Phase 9. |
| 11 | Phase 7 J5 | Narrative inconsistency RESCOS-64 « doublon » vs « station double » | **Résolu Phase 8** ✅ |

### 9.3 Synthèse dette ouverte début Phase 9

- **5 dettes Phase 8** (recalibration max, format scoringRule, négation, r14, bloc presentation patient)
- **6 dettes Phase 7 résiduelles** (#2, #3, #4, #8, #10 + items mineurs)
- **2 dettes Phase 7 fermées en Phase 8** (#9 RESCOS-72 grille, #11 narrative RESCOS-64)

## 10. Vérifications runtime Claude Chrome

| Check | Statut | Commentaire |
|---|---|---|
| `GET /api/patient/RESCOS-64/brief` | ✅ 647 bytes UTF-8 | Baseline Chrome préservée (test J2 supertest) |
| `GET /api/patient/RESCOS-64-P2/brief` | ✅ 200 + 362 bytes UTF-8 | Nouvelle baseline acté J2, `parentStationId` strippé |
| `POST /api/evaluation/presentation` 200 sur RESCOS-64-P2 | ✅ | Réponse contient 4 axes 25 % + parentStationId="RESCOS-64" + weightedScore |
| `POST /api/evaluation/presentation` 400 sur RESCOS-64 (partie 1) | ✅ | body.code='bad_request', message contient « partie 2 » |
| `POST /api/evaluation/presentation` 400 sur transcript vide | ✅ | Validation Zod min(1) |
| `POST /api/evaluation/presentation` 404 sur stationId inexistant | ✅ **post-J4** | Hotfix J4 ajout `not_found` → 404. body.code='not_found' |
| `GET /api/debug/evaluation-weights?stationId=RESCOS-72` | ✅ | 6 axes pondérés Phase 7 J2, sumWeights=100, medico_legal=10 |
| `POST /api/evaluation/legal` sur RESCOS-72 | ✅ | 4 axes Phase 5/7 stable, lexiconVersion=1.1.0, category=certificat_complaisance |
| **`runEvaluation` end-to-end RESCOS-72 (Anthropic Sonnet)** | 🟡 **Test E2E manuel utilisateur** (arbitrage J5-B) | Pas de test automatisé J5 (LLM réel, dépendance clé API + coût + non-déterministe). À exécuter via UI Replit après merge PR. |
| **`runEvaluation` end-to-end RESCOS-64-P2 (Anthropic Sonnet)** | 🟡 **Test E2E manuel utilisateur** | Idem — `runEvaluation` Phase 2/3 uses la grille évaluateur partie 2 ; à valider runtime UI |

---

**Période** : 2026-04-30. **Branche fermée** : `phase-8-stations-doubles`.
**PR** : `#7` — squash merge → `main`. **Tag suggéré post-merge** : `phase-8-final`.
