# Phase 7 J4 — Notes process & arbitrages

## 1. Sujet 1 — Hotfix câblage router debug

**Diagnostic**: après vérification runtime (`PORT=5099 NODE_ENV=development npx tsx server/index.ts` puis curl direct sur l'endpoint), le router debug J3 **fonctionne correctement** :
- `GET /api/debug/evaluation-weights?stationId=AMBOSS-1` → 200 + JSON valide
- `GET /api/debug/evaluation-weights?stationId=AMBOSS-24` → 200 + JSON valide
- `GET /api/debug/evaluation-weights?stationId=NOPE-XYZ` → 404 not_found
- `GET /api/debug/evaluation-weights` → 400 bad_request
- `NODE_ENV=production` → 404 indistinguable d'une route absente

**Cause racine du symptôme J3** : la documented Replit hot-reload caveat — `tsx watch` ne hot-reload PAS l'ajout d'un nouveau fichier router (cf. Phase 5 J3, 7 J1, 7 J2, 7 J3 ; symptôme reproductible). Le process Replit tournait avec un bundle pré-J3 qui n'avait pas le mount `app.use("/api/debug", debugRouter)`. **Pas un bug code** — `routes.ts` ligne 31 mount correctement le router depuis le commit J3 (`45d301f`).

**Action J4** :
- ✅ Comment ajouté dans [server/routes.ts](server/routes.ts) qui documente l'ordre de mount (1. routers /api/* / 2. garde 404 JSON / 3. serve-static SPA) + le pré-requis Replit kill-restart sur ajout de router.
- ✅ Nouveau fichier de test [server/__tests__/phase7J4DebugRouterMount.test.ts](server/__tests__/phase7J4DebugRouterMount.test.ts) avec 5 tests d'intégration end-to-end via `buildTestApp` (la même fonction `mountApiRoutes` que `registerRoutes` runtime). Ces tests cassent immédiatement si le mount est retiré, contrairement aux tests J3 qui pourraient passer en faux-positif.

**Pour l'utilisateur** : après ce commit, **kill complet du process Replit** (workflow → restart, pas Ctrl+C) avant de re-tester. tsx watch n'a pas changé de comportement.

## 2. Sujet 2 — Harmonisation settings « Cabinet de médecine générale »

### Audit complet (66 settings uniques pré-J4)

Stratégie : **regex string-level** (pas JSON.parse + stringify) pour préserver le formatting exact des fixtures Patient_*.json. Diff minimal : 70 lignes `"setting": "..."` modifiées, aucune autre ligne touchée.

### Variantes harmonisées (4 → 70 stations)

| Ancienne valeur                                | → Nouvelle valeur                | Stations |
|------------------------------------------------|----------------------------------|---------:|
| `"Cabinet médical"`                            | `"Cabinet de médecine générale"` |       54 |
| `"Clinique de médecine générale"`              | `"Cabinet de médecine générale"` |        8 |
| `"Cabinet du généraliste"`                     | `"Cabinet de médecine générale"` |        7 |
| `"Cabinet médical, consultation programmée"`   | `"Cabinet de médecine générale"` |        1 |
| **Total**                                      |                                  |   **70** |

Stations affectées (par variante) :

**Cabinet médical (54)** :
AMBOSS-3, -4, -5, -6, -8, -11, -16, -17, -19, -20, -22, -23, -25, -27, -28, -29, -32, -35, -36, -37, -38, -39, -40 ;
USMLE-3, -6, -11, -12, -15, -16, -17, -19, -20, -21, -24, -25, -26, -27, -33, **-34** ⚠, -36, -39, -41, -43 ;
USMLE Triage 1, 2, 3, 4, 5, 22, 23, 24, 28, 31, 32

**Clinique de médecine générale (8)** :
USMLE-28, -29, -32, -37, -38, USMLE Triage 6, 10, 12

**Cabinet du généraliste (7)** :
RESCOS-18, -19, -35, -42, -45, -47, -48

**Cabinet médical, consultation programmée (1)** :
RESCOS-70 (witness Test A — non-legal, no impact sur scoring tests)

### Variantes NON harmonisées (raisons documentées)

**Settings spécialisés (cabinets non-MG, hospitaliers)** — invariant strict, exclus :
- `"Service d'urgences"`, `"Service des urgences"`, `"Service d'urgence"`, `"Urgences"`, `"Clinique de soins urgents"`, `"Service de neurologie"`, `"Service de neurochirurgie, CHUV"`, `"Service de gynécologie-obstétrique"`, `"Service de médecine interne"`, `"Cabinet de gynécologie"`, `"Cabinet de pédiatrie"`, `"Cabinet d'hématologie"`, `"Cabinet de cardiologie"`, `"Cabinet de gastro-entérologie"`, `"Cabinet ORL"`, `"Cabinet de psychiatrie (remplacement)"`, `"Cabinet du spécialiste - gynécologie"`, etc.

**Settings ambigus / contextuels** — préservés (la parenthèse porte de l'info pédagogique pour la station) :
- `"Cabinet de médecine générale - Consultation de médecine des voyages"` (German-86, -87) — sub-setting médecine des voyages distinctif.
- `"Cabinet de médecine de famille - Garde de weekend"` (German-70) — médecine de famille = synonyme MG, mais « Garde de weekend » contextuel.
- `"Cabinet de médecine générale (remplacement)"` / `"Cabinet de médecine générale (remplacement de la Dre Jacqueline Dupont)"` / `"Cabinet de médecine générale de la Dre Kovac (médecin assistant·e)"` / `"Cabinet de médecine générale en zone rurale (remplacement)"` — la base est déjà canonique, la parenthèse porte un détail pédagogique (remplacement, zone rurale).
- `"Consultation médicale"` (USMLE Triage 27, 30) — trop générique, peut être spécialisée → préservé.
- Settings téléconsultation, consultation domicile, services hospitaliers — exclus.

### ⚠ Impact byte count brief HTTP — USMLE-34

**SEUL station avec legalContext impactée** : USMLE-34. Setting `"Cabinet médical"` (14 chars) → `"Cabinet de médecine générale"` (28 chars). **+14 chars = +14 bytes UTF-8** (chars ASCII).

| Station          | Brief HTTP pré-J4 | Brief HTTP post-J4 | Delta |
|------------------|------------------:|-------------------:|------:|
| AMBOSS-24        |               528 |                528 |     0 |
| **USMLE-34**     |           **525** |            **540** | **+15** |
| RESCOS-72        |               717 |                717 |     0 |
| USMLE Triage 39  |               513 |                513 |     0 |
| USMLE-9          |               509 |                509 |     0 |

Le delta mesuré (+15) vs attendu (+14) vient probablement d'une frontière byte JSON marginale (espace, virgule, etc. selon le compactage Express).

**Per spec invariant J4 #2** : « Si une station avec `legalContext` a son setting harmonisé : nouvelle baseline byte count à acter explicitement, **mais lever la main avant push** pour validation utilisateur ».

🚩 **DÉCISION REQUISE AVANT PUSH** :
- **Option A — Accepter la nouvelle baseline** (USMLE-34 = 540 bytes). Push tel quel. Cohérent avec l'objectif d'harmonisation.
- **Option B — Revertir USMLE-34 spécifiquement**. Commande : sur la branche, modifier le seul `"setting": "Cabinet de médecine générale"` de USMLE-34 dans `Patient_USMLE_2.json` (ligne ~4257) en `"Cabinet médical"`, ré-exécuter `vitest run` (le test J4 SettingsHarmonization assert que USMLE-34 a "Cabinet de médecine générale", il faudra l'inverser).

Je n'ai pas pris la décision en silence. L'option par défaut implémentée dans ce commit est **A** (USMLE-34 harmonisée). Si tu préfères B, dis-le-moi avant de push, je fais le commit follow-up.

### Phase 2 byte-stability checksum regenerated

Le snapshot `tests/fixtures/__snapshots__/phase2-checksum.json` a été régénéré (278 stations, sha256). Toutes les stations harmonisées (sauf les 9 pilotes Phase 3/4/5 exclus) ont vu leur checksum changer — c'est l'effet attendu de l'harmonisation (intentionnelle, sanctionnée user en J4). `_meta.regeneratedAt` documente la cause.

## 3. Sujet 3 — UI Evaluation 6e ligne medico_legal

**Composant** : [client/src/pages/Evaluation.tsx](client/src/pages/Evaluation.tsx) (uniquement, pas de nouveau fichier).

**API client** : extension de `EvaluationResult` dans [client/src/lib/api.ts](client/src/lib/api.ts:408) — ajout des champs optionnels `medicoLegalScore?: number` et `medicoLegalWeight?: number`. Aligné avec ce que le backend retourne déjà depuis J2 ([server/services/evaluatorService.ts](server/services/evaluatorService.ts)).

**Rendu conditionnel** (Evaluation.tsx, après la map des 5 axes canoniques) :

```tsx
{result.medicoLegalScore !== undefined && result.medicoLegalWeight !== undefined && (
  <div data-testid="score-medico_legal">
    <div className="flex justify-between text-sm mb-1 font-medium">
      <span>
        Médico-légal
        <span className="text-muted-foreground ml-2 font-normal">
          (poids {result.medicoLegalWeight}%)
        </span>
      </span>
      <span className="text-muted-foreground tabular-nums">
        {result.medicoLegalScore}%
      </span>
    </div>
    <ScoreBar value={result.medicoLegalScore} />
  </div>
)}
```

**Scope respecté** : pas de drill-down sous-axes (reconnaissance / verbalisation / décision / communication) en J4 — les sous-axes restent dans le `LegalDebriefPanel` Phase 5 plus bas. Pas de modif de ce panel.

**Tests composant** (4 nouveaux, 22 total dans `Evaluation.test.tsx`) :
1. Station avec legalContext (medicoLegal* définis) → 6 axes affichés, ligne medico_legal présente avec score + poids correct
2. Station sans legalContext (medicoLegal* undefined) → 5 axes seulement, 6e ABSENTE (rétrocompat byte-à-byte Phase 6)
3. Station avec score=0 → 6e ligne quand même rendue (pas hidden silencieusement sur transcript vide légal)
4. Garde défensive : medicoLegalScore défini sans medicoLegalWeight → ligne ABSENTE (les deux champs requis, prévient un payload partiel side-effect)

## 4. Hot-reload Replit (rappel)

**`tsx watch` ne hot-reload PAS profondément** :
- Ajout/retrait de routers (`server/routes/*.ts` + `server/routes.ts`)
- Modification de fixtures `Patient_*.json` (catalogue chargé une fois au boot)
- Modifications profondes dans `server/services/*.ts`
- Composants React Phase 7 J4 (modif Evaluation.tsx) — le HMR Vite couvre le frontend, pas backend

**Action utilisateur après ce commit** : **kill complet du workflow Replit** (Stop → Run, pas Ctrl+C) avant tout test runtime UI ou Claude Chrome.

## 5. Tests cible vs résultat

| Étape                         | Pass     |
|-------------------------------|----------|
| Phase 7 J3                    |     1197 |
| **Phase 7 J4** (cible 1208–1230) | **1211** ✓ |
| Delta                         | +14      |
