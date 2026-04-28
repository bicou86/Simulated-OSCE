# Triage médico-légal — Phase 6

Sorties produites par `scripts/triage-medico-legal.ts`. Chaque ligne est
une station du catalogue avec une suggestion de classification :

| Statut | Sens                                                                    |
|--------|-------------------------------------------------------------------------|
| **A**  | Station pertinente pour les 3 catégories Phase 5, à annoter avec un `legalContext`. |
| **B**  | Station vue, **non applicable** (consultation clinique standard sans dimension médico-légale). |
| **C**  | Station à arbitrer humainement (transposition CH non triviale, scope hors Phase 5/6). |

## Format CSV

Encoding : UTF-8, séparateur virgule, sauts de ligne `\n`, conforme RFC
4180 (les cellules contenant virgules ou guillemets sont entourées de
`"…"`, guillemets internes doublés `""`).

| Colonne                | Description                                                        |
|------------------------|--------------------------------------------------------------------|
| `id`                   | Identifiant court de la station (`AMBOSS-1`, `RESCOS-72`, …).       |
| `source`               | `AMBOSS` / `German` / `RESCOS` / `USMLE` / `USMLE_Triage`.          |
| `title`                | Titre de la station (ce qui suit `« ID - »` dans `id` complet).     |
| `setting`              | Contexte (« Cabinet médical », « Service d'urgences », …).          |
| `stationType`          | Type inféré Phase 2 (anamnese_examen, triage, psy, bbn, pédiatrie, téléconsult). |
| `suggested_status`     | `A` / `B` / `C`.                                                    |
| `suggested_category`   | Une des 3 catégories Phase 5 si `A`, vide pour `B`/`C`.             |
| `confidence`           | 0.0 – 1.0 (déjà-annotée = 1.0 ; règle nominale 0.7-0.9 ; B = 0.6 ; C = 0.3-0.4). |
| `rationale`            | Préfixé du nom de la règle qui a matché : `[nom_règle] explication`. |
| `already_annotated`    | `true` si la station porte déjà un `legalContext` (Phase 5 J1).      |

## Workflow Phase 6

1. **J1 (présent fichier)** — Claude Code génère `phase-6-j1.csv` avec
   les heuristiques déterministes (zéro LLM). Le fichier est commité
   pour traçabilité.
2. **Relecture humaine** — un médecin CH parcourt les lignes :
   * Confirme ou corrige les status A (fixe la catégorie + la
     `confidence` finale).
   * Arbitre les status C ambigus (en passe certains en A si
     pertinents, en B si finalement non applicable, ou les laisse en
     C avec un rationale explicite).
   * Les B sont auditables par échantillonnage (5–10 lignes au hasard).
   * Le fichier revu est exporté en `phase-6-j1-reviewed.csv` (local,
     non commité).
3. **J2** — Claude Code consomme le CSV revu pour pousser les
   annotations `legalContext` effectives dans les fichiers JSON des
   stations status A confirmées (toujours dans les 3 catégories Phase 5).
   `medicoLegalReviewed: true` est posé sur chaque station vue
   (status A annoté, OU status B confirmé non applicable).
4. **J3** — Audit final + bilan d'avancement (combien des 287 stations
   sont passées en revue, combien ont un `legalContext`, scope vers
   Phase 7).

## Reproductibilité

Le script est strictement déterministe : 2 runs successifs produisent le
MÊME CSV (test 8 dans `scripts/__tests__/triageMedicoLegal.test.ts`).
Cette propriété est requise pour que `git diff` soit utile entre runs.

## Convention de nommage

* `phase-6-j1.csv` — premier run référence (commité).
* `phase-6-jN.csv` — runs ultérieurs J2, J3 (générés mais ignorés via
  `.gitignore`).
* `phase-6-j1-validated.csv` — version annotée par le relecteur humain,
  augmentée des colonnes `human_validated_status`,
  `human_validated_category`, `human_notes`. **COMMITÉE** pour
  traçabilité car c'est la source d'autorité de J2 (le script
  `scripts/apply-triage-j2.ts` la consomme).
* `phase-6-j1-reviewed.csv` — alias historique du fichier validé
  (réservé si la convention de nommage évolue).

## J2 — application effective

```bash
npx tsx scripts/apply-triage-j2.ts
```

Le script lit `phase-6-j1-validated.csv`, ouvre chaque fichier de
station JSON, et :

1. Pour les **status A** confirmés : ajoute `legalContext` (uniquement
   sur USMLE Triage 39 en J2 — les 3 pilotes Phase 5 ont déjà le leur)
   ET pose `medicoLegalReviewed: true`.
2. Pour les **status B** confirmés : pose uniquement
   `medicoLegalReviewed: true`.
3. Pour les **status C** : SKIP (USMLE-9 reste sans flag, sera traité
   en Phase 7).

Propriétés clés :

* **Idempotent** : 2 runs successifs ne produisent aucune modification
  supplémentaire (les stations déjà flaggées sont skippées).
* **Préservation byte-for-byte** du formatting des fixtures : le script
  édite le texte source via balanced-braces matching, sans passer par
  `JSON.stringify` (qui reformaterait German_2 et perdrait les trailing
  newlines de German_4 / RESCOS_4).
* **Zéro modification du brief patient** : seuls les champs additifs
  sont ajoutés ; le narratif (id, setting, symptoms, vitals, …) reste
  identique. Les flags ajoutés sont strippés côté HTTP et côté prompt
  LLM (cf. `META_FIELDS_TO_STRIP` + `stripLegalContextOnly`).
