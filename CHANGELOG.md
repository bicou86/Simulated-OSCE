# Changelog

Tous les changements notables de ce projet sont documentés dans ce
fichier. Le format est inspiré de [Keep a Changelog](https://keepachangelog.com/),
les phases de développement sont versionnées chronologiquement
(Phase 1 → Phase N).

## [Phase 7 J1] — Extension lexique médico-légal CH v1.0.0 → v1.1.0

Branche : `phase-7-medico-legal-extension`. Livraison J1 : extension
PURE du lexique pédagogique (4 nouvelles catégories), tests de
couverture, snapshot de non-régression v1.0.0, documentation v2. **Aucune
station du corpus n'est annotée en J1** (les fixtures restent
inchangées byte-à-byte). Annotation de USMLE-9 prévue J3, introduction
du 6ᵉ axe `medico_legal` au scoring prévue J2.

### Added

* **4 nouvelles catégories du lexique v1.1.0**, ajoutées dans
  [`server/lib/legalLexicon.ts`](server/lib/legalLexicon.ts) avec leurs
  entrées must_verbalize / must_avoid (axes : reconnaissance /
  verbalisation / décision / communication) et patterns regex
  défensifs :
  * `violence_sexuelle_adulte` — prise en charge LAVI + médico-légal
    (kit médico-légal sous 72h, centres LAVI, soutien psychologique)
    d'une victime adulte capable de discernement. Décision attendue :
    `refer`. Pas de signalement automatique (autonomie de la victime).
  * `capacite_discernement` — évaluation tripartite CC-16 (comprendre,
    apprécier, décider), test de compréhension active, saisine APEA /
    curatelle de représentation (CC-394, CC-443a). Décision : `refer`.
  * `directives_anticipees` — recherche / respect / rédaction CC-370
    et suivants, mandat pour cause d'inaptitude (CC-360),
    représentation thérapeutique (CC-377, CC-378). Décision : `refer`.
  * `responsabilite_teleconsult` — limites de l'examen à distance,
    vérification d'identité, consentement, consigne de surveillance,
    documentation horodatée, orientation urgences (CDM art. 3 al. 3,
    CO art. 394+398, LPD, FMH directives télémédecine). Décision :
    `refer`.
* **Type `LegalLexiconCategory`** + constante
  `LEGAL_LEXICON_CATEGORIES` (7 valeurs) + helper
  `listLegalLexiconCategories()` qui dérive l'énumération depuis les
  entrées effectives du lexique.
* **Champ `category: LegalLexiconCategory`** ajouté à
  `LegalLexiconEntry` ; chaque entrée du lexique (v1.0.0 et v1.1.0)
  porte maintenant son étiquette de catégorie. Additif strict côté
  scoring (`legalEvaluator` n'utilise pas `category` pour calculer les
  scores — non-régression numérique stricte).
* **Tests de couverture v1.1.0** dans
  [`server/__tests__/legalLexicon.v1.1.0.test.ts`](server/__tests__/legalLexicon.v1.1.0.test.ts)
  (30 tests) :
  * Pour chaque nouvelle catégorie : transcript canonique « parfait »
    score moyen ≥ 75 % ; transcript vide score 0 sur les axes avec
    must_verbalize ; transcripts anti-pattern font remonter ≥ ⌈n/2⌉
    entrées must_avoid ; transcript partiel score 20–70 % ; gradation
    perfect > partial > empty.
  * Énumération : `LEGAL_LEXICON_VERSION === "1.1.0"`,
    `listLegalLexiconCategories()` énumère exactement 7 catégories,
    chaque catégorie a ≥ 1 must_verbalize ET ≥ 1 must_avoid.
  * **Snapshot non-régression v1.0.0** : les patterns des 3 catégories
    Phase 5 produisent EXACTEMENT les mêmes match counts (sur les 3
    transcripts canoniques de référence) qu'au commit `bea866d`
    (clôture Phase 6).
  * **Mutex audit** : marqueurs strictement distinctifs (« art. 321 »,
    « 364bis », « CP-318 », « kit médico-légal », « CC-16 »,
    « CC-370 », « téléconsultation »…) n'apparaissent que dans le
    transcript de leur propre catégorie ; sanity check inverse.
  * **Garde-fou anti-patterns** : aucun anti-pattern ne fire sur le
    transcript « parfait » de sa propre catégorie (où le candidat
    fait bien).
* **42 nouvelles paires positif/négatif** dans
  [`server/__tests__/legalLexicon.test.ts`](server/__tests__/legalLexicon.test.ts)
  pour les 42 nouvelles entrées du lexique (couverture exhaustive
  inchangée : tout key dans `LEGAL_LEXICON` a un cas de test).
* **Documentation pédagogique v2** :
  [`docs/medico-legal-CH-reference-v2.md`](docs/medico-legal-CH-reference-v2.md)
  — référence v1.1.0 avec les 7 catégories (3 v1.0.0 conservées
  textuellement + 4 nouvelles), tableau récapitulatif, glossaire CH
  étendu (LAVI art. 5+15, CC-16, CC-370+, ASSM, CO art. 394+398,
  LPD, kit médico-légal cantonal, mandat pour cause d'inaptitude,
  représentation thérapeutique). Le document v1 reste accessible
  côte-à-côte ([`docs/medico-legal-CH-reference-v1.md`](docs/medico-legal-CH-reference-v1.md)).

### Changed

* **`LEGAL_LEXICON_VERSION`** bumpé de `"1.0.0"` à `"1.1.0"`. Le champ
  `lexiconVersion` retourné par `POST /api/evaluation/legal` reflète
  automatiquement le bump.
* **Enum Zod `legalCategorySchema`** dans
  [`shared/station-schema.ts`](shared/station-schema.ts) étendue par
  4 valeurs additives — passe de 5 à 9 valeurs acceptées (les 5
  Phase 5 sont conservées strictement, dont les 2 réservées
  `signalement_danger_tiers` et `declaration_obligatoire`). 7 valeurs
  disposent d'une couverture lexique en v1.1.0 ; les 2 réservées
  attendent toujours leur extension.

### Notes — invariants J1

1. **ZÉRO modif scoring 5-axes Phase 2/3** —
   `server/services/evaluatorService.ts`,
   `shared/evaluation-weights.ts`,
   `server/services/legalEvaluator.ts` inchangés (`git diff` vide).
2. **ZÉRO modif des 287 fixtures** — `server/data/patient/Patient_*.json`
   inchangés byte-à-byte.
3. **ZÉRO LLM ajouté** — pas de nouvelle dépendance OpenAI / Anthropic.
   La chaîne médico-légale reste 100 % déterministe (regex statiques).
4. **Schéma additif strict** — l'enum Zod ne supprime AUCUNE valeur
   Phase 5 ; le type `LegalLexiconEntry` ajoute `category` sans
   modifier `axis`/`patterns`/`antiPattern`.
5. **Non-régression v1.0.0 stricte** — snapshot numérique des match
   counts vert (cf. `legalLexicon.v1.1.0.test.ts`).
6. **Briefs HTTP identiques byte-à-byte** — `legalContext` continue
   d'être strippé du brief HTTP via `META_FIELDS_TO_STRIP` (Phase 5
   J3) ; aucune fixture n'a été touchée.
7. **Tests baseline** — 1037 → 1151 (+114 tests : 42 paires de cas
   d'entrée × 2 + 30 tests v1.1.0).

### Hors scope J1 (à venir Phase 7)

* **J2** — introduction du 6ᵉ axe `medico_legal` au scoring global,
  poids par défaut 10 %.
* **J3** — annotation de USMLE-9 dans la nouvelle catégorie
  `violence_sexuelle_adulte`.
* **J4** — nettoyage technique : doublon RESCOS-64 + harmonisation
  des 8 variantes de « Cabinet de médecine générale ».
* **J5** — bilan Phase 7, audit corpus étendu, préparation PR.

---

## [Phase 6] — Annotation médico-légale du corpus existant

Branche : `phase-6-triage-medico-legal`. Commits : `fc51dd6` (J1),
`b7b5a75` (J2), J3 (présent commit).

### Added

* **Flag d'audit** `medicoLegalReviewed: boolean` (default `false`) sur
  le schéma de station — voir [`shared/station-schema.ts`](shared/station-schema.ts).
* **Annotation effective** d'1 station nouvelle : USMLE Triage 39
  (`signalement_maltraitance`, sujet mineur, signalement APEA pour
  cas téléphonique). Total annoté : 4/287 stations.
* **Outillage de triage** :
  * [`scripts/triage-medico-legal.ts`](scripts/triage-medico-legal.ts)
    — triage automatique déterministe (zéro LLM) produisant un CSV par
    station avec status A/B/C suggéré.
  * [`scripts/apply-triage-j2.ts`](scripts/apply-triage-j2.ts)
    — application idempotente du CSV validé : ajoute
    `legalContext` aux status A confirmés et pose
    `medicoLegalReviewed: true` aux status B/A. Preservation
    byte-for-byte des fixtures (édition par balanced-braces matching).
* **Fixtures CSV** commitées pour traçabilité :
  * `triage-output/phase-6-j1.csv` — output brut machine.
  * `triage-output/phase-6-j1-validated.csv` — version revue par
    médecin CH (source d'autorité de J2).
* **Documentation pédagogique** :
  * [`docs/phase-6-bilan.md`](docs/phase-6-bilan.md) — bilan de clôture
    Phase 6 (compteurs, dette technique, recommandations Phase 7).
  * [`docs/medico-legal-CH-reference-v1.md`](docs/medico-legal-CH-reference-v1.md)
    — référence pédagogique des 3 catégories du lexique v1.0.0
    (définitions, bases légales CH, anti-patterns, glossaire).
* **Tests d'audit** :
  * `server/__tests__/medicoLegalReviewedAudit.test.ts` (J2) — couverture
    du flag `medicoLegalReviewed` et strip HTTP/LLM.
  * `server/__tests__/phase6CorpusAudit.test.ts` (J3) — audit global
    figé en clôture (10 tests : compteurs, lexique v1.0.0, jurisdictions,
    strip global, non-régression /api/stations).
  * `scripts/__tests__/triageMedicoLegal.test.ts` — déterminisme du
    triage (2 runs ⇒ même CSV).
  * `scripts/__tests__/applyTriageJ2.test.ts` — idempotence + préservation
    byte-for-byte.

### Changed

* `META_FIELDS_TO_STRIP` et `stripLegalContextOnly` dans
  [`server/services/patientService.ts`](server/services/patientService.ts)
  étendus pour stripper aussi `medicoLegalReviewed` du brief HTTP et
  du system prompt LLM (défense contre fuite du flag d'audit interne).

### Notes

* **Aucune modification du scoring 5-axes Phase 2/3** ni du scoring
  médico-légal Phase 5 (`server/routes/evaluator.ts`,
  `server/services/evaluatorService.ts`, `shared/evaluation-weights.ts`,
  `server/services/legalEvaluator.ts`, `server/lib/legalLexicon.ts`
  inchangés).
* **Lexique v1.0.0 figé** : aucune nouvelle catégorie ajoutée. Phase 7
  ouvrira potentiellement `violence_sexuelle_adulte` (USMLE-9 reportée),
  `capacite_discernement` et autres extensions.
* **1 station laissée non annotée** : USMLE-9 (« Agression sexuelle —
  Femme de 25 ans ») — reportée Phase 7 car nécessite extension lexique
  hors scope Phase 6.

---

## [Phase 5] — Stations médico-légales (PR #4)

Commit principal : `463b3d4`. Branche mergée sur `main`.

### Added

* **Schéma `legalContext`** additif optionnel sur les stations (10
  champs : `category`, `jurisdiction`, `subject_status`,
  `applicable_law`, `mandatory_reporting`, `expected_decision`,
  `decision_rationale`, `red_flags`, `candidate_must_verbalize`,
  `candidate_must_avoid`).
* **Lexique fermé v1.0.0** (`server/lib/legalLexicon.ts`) avec 3
  catégories : `secret_pro_levee`, `signalement_maltraitance`,
  `certificat_complaisance`. Patterns regex défensifs (apostrophes
  courbes, abréviations, accents) pour scorer sans LLM.
* **3 stations pilotes** annotées : AMBOSS-24 (refer LAVI),
  USMLE-34 (signalement APEA), RESCOS-72 (decline_certificate).
* **Évaluateur médico-légal** isolé (`/api/evaluation/legal`) — score
  gradé 0/1/2 par item agrégé en pourcentage par axe (reconnaissance,
  verbalisation, decision, communication). 100 % déterministe (zéro
  LLM).
* **Boot guard** `validateLegalContextLawCodes` : tout code listé dans
  `applicable_law` doit avoir une entrée dans `LEGAL_LAW_CODE_PATTERNS`.
* **Strip HTTP/LLM** : `legalContext` exclu de `/api/patient/:id/brief`
  et du system prompt patient via `META_FIELDS_TO_STRIP` et
  `stripLegalContextOnly`. Tests de leak runtime + leak prompt.
* **Directive prompt anti-fuite** : pour les stations avec
  `legalContext`, blacklist explicite des codes/concepts juridiques
  injectée dans le prompt patient (« le patient ne cite jamais le bon
  cadre légal »).
* **Verrou opérationnel `npm run dev:watch`** : script de relance auto
  pour éviter le piège tsx non-watch sur Replit (cf. README §
  « Restart manuel obligatoire »).

### Changed

* `META_FIELDS_TO_STRIP` étendu à `legalContext`.

---

## [Phase 4] — Compose multi-profils (PR #3)

Commit principal : `4641eea`. Branche mergée sur `main`.

### Added

* **Schéma `participants[]`** (rôles : `patient`, `accompanying`,
  `witness`) et `participantSections` (cloisonnement par chemin JSON).
* **Router d'adresse** : sélection du speaker actif (parent vs ado vs
  bébé pré-verbal) à partir du dernier message candidat.
* **Stations pilotes multi-profils** : RESCOS-70 (trifecta canon B1
  pilule cachée), RESCOS-71 (consignes de jeu), RESCOS-9b/13/63.
* **Boot guard** `validateMultiProfileStations` : tout chemin référencé
  dans `participantSections` doit exister dans le JSON, tout tag listé
  doit appartenir à au moins un participant.
* **Filtrage runtime** par scope du speaker actif (sections invisibles
  retirées avant injection au LLM).

---

## [Phase 3] — Images médicales, labs déterministes, profils spécialité

Commit : `c2ac822`. Mergé sur `main`. Documentation détaillée :
[`docs/architecture/phase-3.md`](docs/architecture/phase-3.md).

### Added

* **Pipeline d'images médicales** (vite-plugin-meta-images) avec
  preview locale (`tmp/phase3-previews/`).
* **Labs déterministes** : tableaux statiques par spécialité, zéro LLM.
* **Specialty profile selector** : matching de la station avec un
  profil de spécialité pour ajustement du prompt.

---

## [Phase 2] — Évaluateur 5 axes + station_type inference

Commits : `97adeae`, `276b0bb`, `803e32a`, `aeb7def`, `c292e77`,
`bd8051a`, `8448ddc`.

### Added

* **5 axes d'évaluation pondérés** : anamnese, examen, management,
  cloture, communication.
* **Inférence `stationType`** par 6 règles déterministes
  (`teleconsultation`, `pediatrie_accompagnant`, `bbn`, `psy`,
  `triage`, `anamnese_examen`) — utilisée pour le routing du prompt
  caregiver et l'ajustement des poids.
* **Prompt caregiver** dédié (parent / accompagnant) avec blacklist
  étendue.
* **Tests de non-régression score-à-score** sur fixtures Sonnet mockées
  (verrou anti-dérive du barème).
* **Override server-side des poids** (la valeur Sonnet est ignorée si
  divergente — la table statique fait foi).

---

## [Phase 1.5] — Examiner /lookup

Commit : `dd26ea4`.

### Fixed

* 3 bugs bloquants sur `/api/examiner/lookup` (résolution de catégorie,
  émission `resultat` au niveau catégorie).

---

## [Phase 1] — Streaming SSE + observabilité

Commits : `75f6006`, `6caa1c4`, `76755b0`, `c65ebbe`, `426d5dd`,
`16f0d91`.

### Added

* Streaming SSE `POST /api/patient/chat/stream` avec sentence-chunked
  output.
* Hook client `useStreamingChat` + lecture audio TTS séquentielle.
* JSONL request logger avec estimation du coût USD par appel LLM.
* `/api/admin/stats` (auth `X-Admin-Key`) — agrégation
  par jour, route, modèle.

---

## [Phase 0] — Bootstrap

Commits : `2fbdcaf` → `9036dbb`.

### Added

* Stack initial Express + Vite + React + shadcn/ui.
* Catalogue 285 stations OSCE (AMBOSS, German, RESCOS, USMLE, USMLE_Triage).
* Routes patient (chat, STT Whisper, TTS OpenAI), évaluateur (Anthropic
  Sonnet 4.5).
* Écran Paramètres pour gestion des clés API (`OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`) avec persistance optionnelle dans `.env.local`.
