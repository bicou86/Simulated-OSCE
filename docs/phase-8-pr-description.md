# PR #7 — Phase 8 stations doubles

> **Document copy-paste-ready** pour la création manuelle de la PR sur GitHub.
> Le titre suggéré est en §1 (titre exact à coller). Le corps de PR est en §2.
> Procédure : `https://github.com/bicou86/Simulated-OSCE/compare/main...phase-8-stations-doubles` → coller le titre + le body → "Create pull request".

---

## 1. Titre PR (à coller)

```
Phase 8 — Stations doubles : architecture parentStationId + grille RESCOS-72 + endpoint /api/evaluation/presentation
```

---

## 2. Body PR (à coller)

### Résumé exécutif

Phase 8 introduit l'architecture des **stations doubles ECOS** (consultation patient simulé + présentation orale au spécialiste) sous le modèle 2 — stations séparées liées par un champ optionnel `parentStationId`. Cas du corpus actuel : RESCOS-64 toux/hémoptysie. Une nouvelle station RESCOS-64-P2 est indexée distinctement dans le catalog (288 = 287 + 1) et son scoring 4-axes 25 % est isolé dans un endpoint séparé `/api/evaluation/presentation` (heuristique pure, zéro LLM dans la décision finale). Phase 8 ferme également la dette Phase 5 J1 (grille évaluateur RESCOS-72 absente) avec une grille 5 axes / 20 items rédigée par l'utilisateur (validation médicale experte requise pour invention pédagogique). Hotfix runtime J4 sur le mapping `not_found` → 404 dans l'API. **Aucune des 287 stations historiques n'est régressée byte-à-byte** (5 baselines briefs Phase 7 stables + 647 bytes RESCOS-64 partie 1 préservés + 362 bytes RESCOS-64-P2 nouvelle baseline actée).

### Commits J1 → J5

| Jour | Hash | Sujet |
|---|---|---|
| P8.0 | `ef5f9be` | docs: ajout fichier référence grilles RESCOS-64 (parties 1+2) |
| J1 | `8b6ad51` | Schéma `parentStationId` additif optionnel + validation référentielle two-pass post-init catalog |
| J2 | `7aa4210` | Fixture RESCOS-64-P2 + `extractShortId` pattern -P2 + stripping parentStationId + snapshots 287→288 |
| J3 | `234d006` | Endpoint `/api/evaluation/presentation` + scoring 4-axes RESCOS-64-P2 (heuristique pure, 50 tests) |
| J4 | `e6da90f` | Grille évaluateur RESCOS-72 (dette Phase 5 J1 fermée) + hotfix 404 + test runtime console.warn |
| J5 | (commit J5) | Bilan Phase 8 + audit 282 stations + PR description + cleanup |

### Invariants prouvés (checklist)

- [x] Schéma additif strict (zéro modif `legalEvaluator`, `evaluation-weights`, scoring 6-axes, fixtures `Patient_*.json` autres que RESCOS-64-P2 partie 2 ajoutée)
- [x] 7 briefs HTTP byte-à-byte stables : 528 (AMBOSS-24) / 540 (USMLE-34) / 717 (RESCOS-72) / 513 (USMLE Triage 39) / 509 (USMLE-9) + 647 (RESCOS-64 partie 1) + **362 (RESCOS-64-P2 nouvelle baseline)**
- [x] `lexiconVersion v1.1.0` maintenu
- [x] `parentStationId` jamais leaké dans `/api/patient/:id/brief` (META_FIELDS_TO_STRIP étendu en J2)
- [x] Catalog 287 → **288 stations** (RESCOS-64-P2 indexable distinctement)
- [x] Endpoint `/api/evaluation/presentation` : 4 codes HTTP testés runtime (200 / 400×2 / 404 hotfix J4)
- [x] Endpoint `/api/evaluation/legal` snapshot inchangé sur 5 stations (route POST /legal non touchée)
- [x] Endpoint `/api/debug/evaluation-weights` opérationnel (RESCOS-72 retourne 6 axes Phase 7 J2 stables)
- [x] Zéro LLM dans la décision finale (heuristique pure)
- [x] Grille RESCOS-72 conforme (5 axes ECOS classiques, 20 items, modes scoringRule count + alias-binaire validés)

### Baselines acquises Phase 8

**Briefs HTTP UTF-8** (mesurés via `Buffer.byteLength(json, 'utf-8')`) :

```
AMBOSS-24       = 528 bytes (Phase 7 stable)
USMLE-34        = 540 bytes (Phase 7 stable)
RESCOS-72       = 717 bytes (Phase 7 stable, grille évaluateur ajoutée mais brief patient inchangé)
USMLE Triage 39 = 513 bytes (Phase 7 stable)
USMLE-9         = 509 bytes (Phase 7 stable)
RESCOS-64       = 647 bytes (partie 1, baseline préservée — shortId asymétrique R3)
RESCOS-64-P2    = 362 bytes (partie 2, NOUVELLE baseline Phase 8 J2)
```

**Catalog** : 288 stations distinctes (287 historiques + RESCOS-64-P2).

**lexiconVersion** : v1.1.0 (Phase 7 J1+J3, 7 catégories actives, inchangé).

**Tests** : **1331 pass** (Phase 7 final = 1211, **delta Phase 8 = +120**), 12 skipped, 0 fail.

### Dette Phase 9 portée

**5 dettes nouvelles Phase 8** (cf. [`docs/phase-8-bilan.md`](docs/phase-8-bilan.md) §9.1) :
1. Recalibration max scoringRule (cleanup fixture ou LLM-assist) — origine J3
2. Format scoringRule token-based (normalisation discriminant explicite) — origine J3
3. Détection négation transcript (LLM-assist) — origine J3
4. Évaluation r14 « Aucun argument » (skip silent actuel, LLM-assist) — origine J3
5. Bloc `presentation` côté patient `Patient_RESCOS_4.json:3320-3447` (audit historique git blame) — origine J2

**Dettes Phase 7 résiduelles** (cf. §9.2) :
- #2 Communication weight=0 stations triage
- #3 Catégories enum sans couverture lexique (signalement_danger_tiers, declaration_obligatoire)
- #4 Variantes settings ambiguës non harmonisées
- #8 282 stations sans legalContext — décision Phase 9+ (audit livré J5, pas d'extension Phase 8)
- #10 Flake test `phase7J4SettingsHarmonization` (race condition fichiers temporaires)

**Dettes Phase 7 fermées en Phase 8** :
- #9 RESCOS-72 grille évaluateur ✅ (J4)
- #11 Narrative inconsistency RESCOS-64 « doublon » vs « station double » ✅

### Test runtime manuel utilisateur (post-merge)

Arbitrage utilisateur J5-B : pas de test E2E automatisé pour `runEvaluation` Anthropic Sonnet (coût + non-déterministe + dépendance clé API). À exécuter manuellement via UI Replit après merge PR :

1. **`runEvaluation` end-to-end RESCOS-72** (grille fermée J4) — vérifier que Sonnet consomme la nouvelle grille 5 axes / 20 items et retourne un scoring complet sans erreur. Cas attendu : station avec `legalContext = certificat_complaisance` → scoring 6-axes (5 grille + medico_legal additif).
2. **`runEvaluation` end-to-end RESCOS-64-P2** (partie 2 station double) — vérifier que `getEvaluatorStation("RESCOS-64-P2")` retourne bien la grille `presentation/raisonnement/examens/management` 4 axes 25 %.
3. **`POST /api/evaluation/presentation`** runtime sur RESCOS-64-P2 avec un transcript candidat réel (UI ou curl) — vérifier 200 + 4 axes + parentStationId="RESCOS-64".

### Stratégie merge

- **Type** : squash merge → `main` (1 commit final, message à régler avec le titre PR)
- **Branch deletable post-merge** : oui
- **Conflits attendus** : aucun (additif strict, parent à jour `e4c75be`)
- **Tag suggéré** : `phase-8-final` (optionnel, pour traçabilité release)

### Risques merge

- **Aucun** : additif strict, zéro modif scoring 6-axes, zéro modif `legalEvaluator`, zéro modif `evaluation-weights`, lexicon stable v1.1.0.
- Le seul fichier de fixture modifié côté patient est `Patient_RESCOS_4.json` (RESCOS-64-P2 partie 2 complétée +3 lignes additives, partie 1 byte-à-byte intacte).
- Le seul fichier de fixture modifié côté évaluateur est `Examinateur_RESCOS_4.json` (grille RESCOS-72 ajoutée +255 lignes en fin de fichier, RESCOS-71 et autres stations byte-à-byte intactes).
- **tsx watch caveat** : kill complet workflow Replit recommandé après merge avant les tests runtime UI (les modifications hot-path : router error code, fixtures Examinateur, extractShortId pattern).

### Documents Phase 8 (référence post-merge)

- [`docs/phase-8-bilan.md`](docs/phase-8-bilan.md) — Bilan complet de clôture
- [`docs/phase-8-audit-282-stations.md`](docs/phase-8-audit-282-stations.md) — Mini sondage corpus, rapport heuristique
- [`docs/phase-8-rescos-64-grilles-reference.txt`](docs/phase-8-rescos-64-grilles-reference.txt) — Référence grilles RESCOS-64 (P8.0)
- [`docs/phase-8-rescos-72-grille-template.json`](docs/phase-8-rescos-72-grille-template.json) — Template vide RESCOS-72 (J4 workflow)
- [`docs/phase-8-rescos-72-grille-filled.json`](docs/phase-8-rescos-72-grille-filled.json) — Grille remplie utilisateur (J4, traçabilité)
- [`docs/phase-8-pr-description.md`](docs/phase-8-pr-description.md) — Le présent document

---

## 3. Checklist post-merge (utilisateur)

- [ ] PR #7 mergée en squash sur `main`
- [ ] Branch `phase-8-stations-doubles` supprimée (locale + remote)
- [ ] Tag `phase-8-final` créé (optionnel)
- [ ] Test E2E runtime UI : `runEvaluation` sur RESCOS-72 (Anthropic Sonnet, grille J4)
- [ ] Test E2E runtime UI : `POST /api/evaluation/presentation` sur RESCOS-64-P2 avec transcript candidat
- [ ] Test E2E runtime UI : `POST /api/evaluation/presentation` sur stationId inexistant → vérifier 404 + body.code='not_found'
- [ ] (Optionnel) Tour de Claude Chrome de validation visuelle UI Evaluation 6e ligne medico_legal sur RESCOS-72
- [ ] Démarrer Phase 9 selon dette portée (cf. `docs/phase-8-bilan.md` §9.3)
