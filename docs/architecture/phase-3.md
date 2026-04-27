# Phase 3 — Architecture (images, labs, spécialités)

> Cartographie pour les contributeurs Phase 4+. Synthèse de l'état post-J4
> (commit `test(phase3-j4-fixtures)` sur `phase-3-images-labs-specialties`).

## a) Flow images → labs → spécialités

Phase 3 a empilé trois capacités strictement additives sur la base Phase 2,
sans renommage ni rupture de schéma :

```
J1 (images)        J2 (labs)            J3 (spécialités)
─────────────  ─────────────────────  ───────────────────────
examen_resul   examens_complementaires  patient.md/caregiver.md
tats:                                   profils A/B/C + P1/P2
{ resultat_url }
                  Intent router         specialtyProfileSelector
                  /api/examiner/labs    (déterministe, no LLM)
```

Chaque jour ajoute :
1. un service serveur dédié (`examinerService` étendu pour J1, `labsService`
   pour J2, `specialtyProfileSelector` pour J3) ;
2. des fixtures station ciblées (4 pilotes images, ~4 pilotes labs, 3 pilotes
   spécialités), additives par-dessus les stations Phase 2 ;
3. zéro modification structurelle des 283+ stations Phase 2 (verrou par
   checksum SHA-256, cf. `tests/fixtures/__snapshots__/phase2-checksum.json`).

L'enchaînement runtime côté patient/évaluateur reste celui de Phase 2 :
`stationsService.initCatalog` → `getPatientStation` → `buildSystemPrompt` →
appel OpenAI (patient) ou Anthropic (évaluateur). Phase 3 injecte uniquement
des champs dans le bloc `<station_data>` (J1/J2) ou des directives en queue
de prompt (J3).

## b) Sélecteur déterministe + table de priorité

`server/services/specialtyProfileSelector.ts` est une fonction pure, zéro I/O,
zéro LLM. Règle de priorité (la plus spécifique gagne) :

| Ordre | Trigger                    | Profil retourné  |
|-------|----------------------------|------------------|
| 1     | `register === "palliatif"` | `palliatif`      |
| 2     | `register === "gyneco"`    | `gyneco`         |
| 3     | âge ∈ [14, 17]             | `adolescent`     |
| —     | (aucun trigger)            | `null` (bypass)  |

Aux 3 profils correspondent 5 directives possibles selon le template chargé
(`patient.md` vs `caregiver.md`) — le mapping est dans
`buildSpecialtyDirective()`. Combinaison `caregiver + gyneco` = `null`
(non-applicable, pas de cas dédié).

L'âge est résolu par `parseStationAgeYears()` avec priorité au champ explicite
`patient_age_years`, fallback regex sur `age` puis `patient_description`. Même
politique que `labsService.parsePatientAge()` pour cohérence.

Fallbacks intent-router (cf. `server/lib/intentRouter`-style logic dans
`examinerService` + `labsService`) : `no_teleconsult` > `no_imaging` >
`no_labs`. Règle stable (voir tests).

## c) Registres prompt et appariement patient ↔ caregiver

| Template          | Profils actifs                      | Few-shot exemples |
|-------------------|-------------------------------------|-------------------|
| `patient.md`      | A (gyneco), B (ado), C (palliatif)  | A1-A4, B1-B3, C1-C3 |
| `caregiver.md`    | P1 (parent ado), P2 (proche pall.)  | E, F, G, H, I, J  |

Routing template (cf. `patientService.buildSystemPrompt`) :
- `interlocutor.type === "parent"` (cf. `resolveInterlocutor`) ⇒ `caregiver.md`
- sinon ⇒ `patient.md`

Phase 3 J3 a étendu `resolveInterlocutor` pour reconnaître les rôles proches
adulte (`fille`, `fils`, `conjoint·e`, `accompagnant·e`, `proche`) qui
basculent sur `parentRole = "caregiver"`. Ces stations bénéficient
automatiquement du caregiver template + Profil P2 si elles portent
`register: "palliatif"`.

Inversement, l'adolescent solo (Emma, RESCOS-70) reste sur `patient.md` même
si la station mentionne une mère présente — le LLM joue toujours l'ado, la
mère est un élément narratif de la station joué par l'instructeur humain en
salle d'examen.

## d) Schéma additif

Champs ajoutés Phase 3 (tolérance 0 sur les champs existants Phase 2). Tous
optionnels, tous additifs.

| Champ                 | Phase | Type      | Effet                                  |
|-----------------------|-------|-----------|----------------------------------------|
| `examen_resultats.{cat}.resultat_url` | J1 | string  | URL d'image servie par `/medical-images/...` |
| `examens_complementaires.{lab}` | J2 | object | Block labs structuré (cf. `shared/lab-definitions.ts`) |
| `register`            | J3    | enum    | `"gyneco" \| "palliatif"` — déclenche profil A ou C/P2 |
| `patient_age_years`   | J3    | number  | Âge canonique numérique, lu en priorité par le selector |
| `tags`                | J3    | string[] | Marqueurs sémantiques libres (audit, filtres futurs) |
| `motif_cache`         | J3    | object  | Motif réel vs motif affiché — utilisé par patient.md Profil B |

Aucun rename, aucune migration. Les 283 stations Phase 2 non-pilotes restent
byte-identiques (verrouillé par `phase2Checksum.test.ts`).

## e) Invariants ECOS rappelés

Cinq invariants stables, vérifiés par les fixtures J3 + le test gated J4
(`tests/integration/ecos-invariants.test.ts`) :

1. **Schéma additif uniquement, zéro rename.** Les 284 stations gardent leur
   structure Phase 2 ; Phase 3 ajoute des champs optionnels.
2. **Aucune migration LLM des 284 stations sans human-in-the-loop.** Les 3
   pilotes ont été curés à la main et restent les seuls J3-flagged.
3. **Pas de LLM dans les heuristiques structurelles.** Sélecteur,
   classifier intent, table de poids, parsing d'âge — tout en pure
   TypeScript, testé déterministe.
4. **Patient ne donne JAMAIS de findings d'examen objectif** (auscultation,
   TA chiffrée non vécue, SaO2, etc.) ; détection log-only via
   `patientLeakDetection`.
5. **Accompagnant·e utilise un vocabulaire non-médical.** Caregiver prompt
   blacklist élargie, registre naïf, reformulations explicites.

L'invariant 6 (priorité fallbacks `no_teleconsult` > `no_imaging` >
`no_labs`) est verrouillé par les tests `examiner.test.ts` + `labs.test.ts`.

## f) Stations pilotes Phase 3 + fixtures

| Phase | Station          | Profil       | Fixture(s)                                                      |
|-------|------------------|--------------|-----------------------------------------------------------------|
| J1    | AMBOSS-14        | (image ECG)  | `client/public/medical-images/AMBOSS-14/`                       |
| J1    | AMBOSS-4         | (image dermato) | `client/public/medical-images/AMBOSS-4/`                     |
| J1    | German-30        | (image)      | `client/public/medical-images/German-30/`                       |
| J1    | German-69        | (image)      | `client/public/medical-images/German-69/`                       |
| J1    | RESCOS-68        | (image)      | `client/public/medical-images/RESCOS-68/`                       |
| J2    | (multi)          | labs         | `server/__tests__/labs.test.ts` (fixtures inline)               |
| J3    | AMBOSS-4         | gyneco (A)   | `tests/fixtures/specialties/gyneco-amboss4.json`                |
| J3    | RESCOS-70        | adolescent (B) | `tests/fixtures/specialties/ado-rescos70.json`                |
| J4    | RESCOS-70 (P1-bis) | adolescent (B branched) | `tests/fixtures/specialties/ado-rescos70-parent-insistant.json` |
| J3    | RESCOS-71        | palliatif (P2) | `tests/fixtures/specialties/palliatif-rescos71.json`          |

Les fixtures J3 sont **gold-standard pédagogiques** : elles documentent les
réponses attendues du LLM patient/caregiver dans 3 conversations chacune (B1,
B2, B3 pour l'ado ; A1-A4 pour gyneco ; H, I, J pour palliatif). Elles ne
testent PAS la sortie LLM exacte (température > 0 ⇒ non-reproductible), mais
verrouillent le câblage déterministe (template + directive) via
`server/__tests__/specialtyFixtures.test.ts`.

La fixture J4 (P1-bis) est **branchée** : deux outcomes (success / failure)
selon que le candidat tient ou cède sous pression émotionnelle de la mère.
Invariant global : Emma ne révèle JAMAIS la pilule tant que sa mère est dans
la pièce, peu importe la branche.

## Pointeurs croisés

- Tests unitaires sélecteur : [server/__tests__/specialtyProfileSelector.test.ts](../../server/__tests__/specialtyProfileSelector.test.ts)
- Tests fixtures J3 : [server/__tests__/specialtyFixtures.test.ts](../../server/__tests__/specialtyFixtures.test.ts)
- Tests checksum Phase 2 : [server/__tests__/phase2Checksum.test.ts](../../server/__tests__/phase2Checksum.test.ts)
- Tests intégration LLM (gated) : [tests/integration/ecos-invariants.test.ts](../../tests/integration/ecos-invariants.test.ts)
- Sélecteur de spécialité : [server/services/specialtyProfileSelector.ts](../../server/services/specialtyProfileSelector.ts)
- Service patient + buildSystemPrompt : [server/services/patientService.ts](../../server/services/patientService.ts)
- Prompts : [server/prompts/patient.md](../../server/prompts/patient.md), [server/prompts/caregiver.md](../../server/prompts/caregiver.md)
- Définitions labs : [shared/lab-definitions.ts](../../shared/lab-definitions.ts)

## Hors-scope Phase 3 — pour Phase 4

- Compose multi-profils (ado + gynéco simultanés)
- Déploiement multi-candidats simultanés
- Évaluation auto-corrective / feedback longitudinal
- Cas médico-légaux complexes (refus de soins, mineur sans représentant…)
- Migration LLM des 283 stations vers schéma enrichi (humain-in-the-loop)
