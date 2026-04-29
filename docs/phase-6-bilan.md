# Phase 6 — Bilan de clôture

> Phase d'annotation médico-légale du corpus existant (287 stations
> OSCE). Ce document fige l'état du corpus à la fin de Phase 6,
> documente la dette technique laissée pour Phase 7, et trace le
> workflow de relecture humaine pour reproductibilité future.

## Sommaire

1. [Résumé exécutif](#1-résumé-exécutif)
2. [Périmètre initial vs périmètre final](#2-périmètre-initial-vs-périmètre-final)
3. [État du corpus en sortie de Phase 6](#3-état-du-corpus-en-sortie-de-phase-6)
4. [Bilan par source](#4-bilan-par-source)
5. [Workflow de relecture humaine](#5-workflow-de-relecture-humaine)
6. [Outils livrés](#6-outils-livrés)
7. [Invariants verrouillés](#7-invariants-verrouillés)
8. [Dette technique reportée Phase 7](#8-dette-technique-reportée-phase-7)
9. [Recommandations Phase 7](#9-recommandations-phase-7)

---

## 1. Résumé exécutif

Phase 6 visait l'annotation médico-légale d'environ 50 stations
ambiguës détectées par le triage automatique, parmi les 287 stations
historiques du corpus. La relecture par un médecin suisse formé en
droit médical a fortement réduit ce périmètre : sur les ~50
candidates, **une seule station nouvelle a été annotée** (USMLE Triage
39), portant le total annoté de **3 (Phase 5) à 4 (Phase 6)**. Les 282
autres ont été marquées « vues, non applicables » via le flag d'audit
`medicoLegalReviewed: true`. Une station (USMLE-9, agression sexuelle)
reste non annotée car elle déborde des 3 catégories du lexique v1.0.0
gelé en Phase 6.

La compression du livrable est un succès méthodologique, pas un
échec : elle traduit la rigueur du périmètre Phase 5/6 (3 catégories
strictement encadrées par la jurisprudence suisse) face à un corpus
historiquement orienté USMLE/AMBOSS dont la dimension juridique est
essentiellement nord-américaine. La valeur ajoutée de Phase 6 réside
dans :

* l'**outillage** déterministe et reproductible (triage CSV, application
  idempotente, tests d'audit globaux) ;
* la **documentation pédagogique** (référence médico-légale CH v1) ;
* l'identification précise de la **dette Phase 7** (extension lexique
  vers violence sexuelle adulte, capacité de discernement, directives
  anticipées).

## 2. Périmètre initial vs périmètre final

| Élément | Cadrage initial Phase 6 | Réalité après relecture médecin |
|---------|------------------------|----------------------------------|
| Stations à annoter | ≈ 50 candidates A (heuristique) | **1 station** (USMLE Triage 39) |
| Stations à reviewer | ≈ 230 candidates B | **282 stations** |
| Stations status C | ≈ 7 candidates ambigües | **5 stations** dont 4 reclassées en B et 1 (USMLE-9) maintenue C |
| Schéma `legalContext` | Stable Phase 5 | **Inchangé** (additif strict) |
| Lexique v1.0.0 | Gelé pour la phase | **Gelé** (3 catégories — pas d'extension) |

### Justification de la compression

Le médecin relecteur a appliqué un critère strict : ne marquer une
station status A que si la **décision attendue** (signaler / refuser
certificat / lever le secret) est **explicitement requise** par les
faits du brief existant, ET que les bases légales suisses correspondent
**directement** à l'une des 3 catégories du lexique v1.0.0. Toute
station nécessitant une réécriture du brief, une transposition CH
substantielle, ou une catégorie non encore lexicalisée a été
explicitement placée hors scope Phase 6 — sans modifier le brief, par
respect de l'invariant Phase 5 « brief HTTP byte-à-byte identique ».

Le résultat est un corpus annoté minimal mais **juridiquement défendable
sur chaque cas**, plutôt qu'un corpus large mais discutable au cas par
cas. C'est la décision méthodologique attendue pour une plateforme
pédagogique exposée à des étudiants en médecine — une fausse annotation
serait pire que pas d'annotation.

## 3. État du corpus en sortie de Phase 6

| Compteur | Valeur |
|---|---|
| Total stations uniques (dédup par shortId) | **287** |
| Stations avec `legalContext` | **4** |
| Stations avec `medicoLegalReviewed: true` | **286** |
| Stations sans aucun flag | **1** (USMLE-9) |

### Stations annotées (`legalContext`)

| ID | Catégorie | Décision | Bases légales | Statut sujet |
|---|---|---|---|---|
| AMBOSS-24 | `secret_pro_levee` | `refer` | CP-321, CP-364, LAVI-art-1 | adult_capable |
| USMLE-34 | `signalement_maltraitance` | `report` | CP-321, CP-364, CP-364bis, CC-307, CC-314c | adult_capable |
| RESCOS-72 | `certificat_complaisance` | `decline_certificate` | CP-318, CDM-FMH-art-34, CO-art-324a | adult_capable |
| USMLE Triage 39 | `signalement_maltraitance` | `report` | CP-321, CP-364, CP-364bis, CC-307, CC-314c | minor |

### Phase d'origine de chaque annotation

* Phase 5 J1 (pilotes initiaux) : AMBOSS-24, USMLE-34, RESCOS-72.
* Phase 6 J2 (annotation incrementale) : USMLE Triage 39
  (cas téléphonique, suspicion de maltraitance d'une mineure).

### Cas spéciaux

* **USMLE-9** (« Agression sexuelle - Femme de 25 ans ») : **reportée
  Phase 7**. Le scénario relève d'une catégorie absente du lexique
  v1.0.0 (« violence sexuelle adulte / recueil de preuves médico-légales
  / LAVI étendu »). Aucun flag posé pour signaler clairement à Phase 7
  qu'une décision active reste à prendre.
* **RESCOS-64 doublon** : la station « RESCOS-64 - Toux - Station
  double » apparaît deux fois dans `Patient_RESCOS_4.json` (héritage
  Phase 4). Les deux occurrences portent `medicoLegalReviewed: true` ;
  le test d'audit dédupe sur `shortId` (cf. `medicoLegalReviewedAudit`,
  `phase6CorpusAudit`). Nettoyage technique reporté Phase 7.

## 4. Bilan par source

| Source | Total stations | Annotées | Reviewed | Sans flag |
|---|---|---|---|---|
| AMBOSS | 40 | 1 (AMBOSS-24) | 40 | 0 |
| German | 88 | 0 | 88 | 0 |
| RESCOS | 75 | 1 (RESCOS-72) | 75 | 0 |
| USMLE | 44 | 1 (USMLE-34) | 43 | 1 (USMLE-9) |
| USMLE_Triage | 40 | 1 (USMLE Triage 39) | 40 | 0 |
| **Total** | **287** | **4** | **286** | **1** |

### Observations par source

* **German (0/88)** : aucune annotation. Les briefs allemands
  traduits sont essentiellement consultations cliniques courantes,
  sans dimension médico-légale CH formalisable dans v1.0.0.
* **AMBOSS (1/40)** : seul AMBOSS-24 (violence domestique, refer LAVI).
  Le reste du corpus AMBOSS est très orienté diagnostic, faible
  intersection avec le lexique CH.
* **RESCOS (1/75)** : seul RESCOS-72 (certificat de complaisance).
  Plusieurs stations RESCOS ont été identifiées comme **candidates
  Phase 7** (BBN, psy non-suicidaire — cf. § 8).
* **USMLE (1/44)** : USMLE-34 + USMLE-9 reportée. Les autres
  scénarios USMLE ne mappent pas le droit suisse (cadre légal US implicite).
* **USMLE_Triage (1/40)** : USMLE Triage 39. Forte concentration de
  scénarios téléconsult — candidats Phase 7+ pour une catégorie
  « responsabilité médicale en téléconsultation ».

## 5. Workflow de relecture humaine

Procédure documentée pour reproductibilité Phase 7+ :

### Étape 1 — Triage automatique (Claude Code)

```bash
npx tsx scripts/triage-medico-legal.ts
```

Produit `triage-output/phase-6-jN.csv` avec une ligne par station,
contenant : `id`, `source`, `title`, `setting`, `stationType`,
`suggested_status` (A/B/C), `suggested_category`, `confidence`,
`rationale`, `already_annotated`. Heuristiques déterministes (zéro
LLM). Le script résume aussi à l'écran les counts par statut et par
source.

### Étape 2 — Relecture par médecin CH

Le médecin parcourt le CSV et complète 3 colonnes :

* `human_validated_status` (A / B / C, possiblement différent de la
  suggestion machine).
* `human_validated_category` (catégorie Phase 5 si A, vide sinon).
* `human_notes` (justification courte, en particulier si C ou si la
  catégorie diffère de la suggestion).

Le fichier validé est sauvegardé en `triage-output/phase-6-jN-validated.csv`
puis **commité** (source d'autorité de l'application J2). Cette double
trace (machine + médecin) permet d'auditer rétroactivement chaque
décision d'annotation.

Critère de validation A retenu en Phase 6 : la décision attendue
(signaler / refuser certificat / lever le secret) doit être **non
ambigüe** sur les faits du brief tels quels, ET la catégorie doit
appartenir au lexique v1.0.0. Tout autre cas → B ou C.

### Étape 3 — Application idempotente (Claude Code)

```bash
npx tsx scripts/apply-triage-j2.ts
```

Lit le CSV validé, ouvre chaque fichier `Patient_*.json`, et :

* Pour les **status A confirmés** non encore annotés : ajoute
  `legalContext` (la fixture détaillée — bases légales,
  `decision_rationale`, `red_flags`, `candidate_must_verbalize`,
  `candidate_must_avoid` — est rédigée en amont par le médecin pour
  chaque cas A nouveau).
* Pour les **status A confirmés** déjà annotés (pilotes Phase 5) ET
  les **status B confirmés** : pose `medicoLegalReviewed: true` si
  absent.
* Pour les **status C** : SKIP (l'absence de flag signale clairement
  qu'une décision active reste à prendre).

Propriétés clés : **idempotent** (2 runs successifs ne produisent
aucune modification), **byte-for-byte preserving** (édition par
balanced-braces matching, sans `JSON.stringify` qui reformaterait le
fichier), **strip HTTP/LLM** garanti par
[`META_FIELDS_TO_STRIP`](../server/services/patientService.ts#L429).

### Étape 4 — Audit corpus (Claude Code)

```bash
npx vitest run server/__tests__/phase6CorpusAudit.test.ts
```

Vérifie les compteurs globaux (287 stations / 4 annotées / 286
reviewed / 1 sans flag), la cohérence du lexique (3 catégories
v1.0.0 uniquement, jurisdiction CH, codes mappés), et l'absence de
fuite des champs additifs dans le brief HTTP. Tout écart bloque la
clôture de phase.

## 6. Outils livrés

### Scripts d'outillage

* [`scripts/triage-medico-legal.ts`](../scripts/triage-medico-legal.ts)
  — triage automatique déterministe (J1).
* [`scripts/apply-triage-j2.ts`](../scripts/apply-triage-j2.ts)
  — application idempotente du CSV validé (J2).

### Fixtures CSV (commités pour traçabilité)

* [`triage-output/phase-6-j1.csv`](../triage-output/phase-6-j1.csv)
  — output brut machine.
* [`triage-output/phase-6-j1-validated.csv`](../triage-output/phase-6-j1-validated.csv)
  — version revue par le médecin CH.

### Schéma additif (étendu Phase 6)

* `medicoLegalReviewed: z.boolean().optional().default(false)` dans
  [`shared/station-schema.ts`](../shared/station-schema.ts#L184) — flag
  d'audit Phase 6.
* Aucune modification du schéma `legalContext` Phase 5
  (additif strict respecté).

### Strip HTTP/LLM (étendu Phase 6)

* `medicoLegalReviewed` ajouté à `META_FIELDS_TO_STRIP` et à
  `stripLegalContextOnly` dans
  [`server/services/patientService.ts`](../server/services/patientService.ts#L429-L458).

### Tests d'audit

* [`server/__tests__/medicoLegalReviewedAudit.test.ts`](../server/__tests__/medicoLegalReviewedAudit.test.ts)
  (Phase 6 J2) — couverture du flag.
* [`server/__tests__/phase6CorpusAudit.test.ts`](../server/__tests__/phase6CorpusAudit.test.ts)
  (Phase 6 J3) — audit global figé en clôture.
* [`scripts/__tests__/triageMedicoLegal.test.ts`](../scripts/__tests__/triageMedicoLegal.test.ts)
  — déterminisme du triage.
* [`scripts/__tests__/applyTriageJ2.test.ts`](../scripts/__tests__/applyTriageJ2.test.ts)
  — idempotence + préservation byte-for-byte.

### Documentation

* [`docs/phase-6-bilan.md`](./phase-6-bilan.md) — ce document.
* [`docs/medico-legal-CH-reference-v1.md`](./medico-legal-CH-reference-v1.md)
  — référence pédagogique consolidée des 3 catégories v1.0.0.
* [`triage-output/README.md`](../triage-output/README.md) — format CSV
  + workflow de relecture (mis à jour Phase 6 J2).

## 7. Invariants verrouillés

Tous les invariants Phase 5 restent en place. Phase 6 ajoute :

| Invariant | Vérification |
|---|---|
| Lexique v1.0.0 figé (3 catégories) | `phase6CorpusAudit` § « toutes les categories utilisées sont dans le lexique v1.0.0 » |
| Jurisdiction CH uniquement | `phase6CorpusAudit` § « toutes les jurisdictions valent CH » |
| 4 stations annotées (set fixe) | `phase6CorpusAudit` § « 4 stations portent un legalContext » |
| 286 stations reviewed | `phase6CorpusAudit` § « 286 stations portent medicoLegalReviewed=true » |
| USMLE-9 = seule station sans flag | `phase6CorpusAudit` § « 1 station n'a ni legalContext ni medicoLegalReviewed » |
| Pas de fuite des champs additifs | `phase6CorpusAudit` § « strip HTTP global » + `medicoLegalReviewedAudit` |
| `applicable_law` mappé | boot guard `validateLegalContextLawCodes` + `phase6CorpusAudit` |
| /api/stations renvoie 287 entrées | `phase6CorpusAudit` § non-régression Phase 5 |
| Brief HTTP byte-à-byte sur stations sans `legalContext` | témoins manuels J2 (AMBOSS-1 524 bytes, RESCOS-1, RESCOS-7, USMLE-1, German-1) |
| Idempotence du script `apply-triage` | `applyTriageJ2.test` |

## 8. Dette technique reportée Phase 7

### 8.1 Annotation USMLE-9 (« Agression sexuelle - Femme de 25 ans »)

* **Action** : créer le `legalContext` complet une fois le lexique
  v1.1.0 étendu.
* **Bloqueur** : la catégorie « violence sexuelle adulte / recueil de
  preuves médico-légales » n'existe pas en v1.0.0. Les bases légales
  CH typiques (LAVI étendu, art. 198/189/190 CP, certificat médical à
  fin de preuve, kit médico-légal cantonal) ne sont mappées nulle
  part dans `LEGAL_LAW_CODE_PATTERNS`.
* **Décision attendue** : `refer` (orientation gynéco-obstétrique +
  centre LAVI + consentement explicite à la documentation pour
  preuve) ; signalement non obligatoire pour majeur capable mais
  fortement encouragé.

### 8.2 Stations psy non-suicidaires — candidates `capacite_discernement`

* Plusieurs stations psy (RESCOS, USMLE) mettent en scène un patient
  dont la capacité de discernement est questionnée mais sans
  intention suicidaire active. En droit suisse, l'art. 16 CC
  (capacité de discernement) et l'art. 443a CC (signalement APEA
  adulte vulnérable) constitueraient une 4e catégorie crédible.
* **Action Phase 7** : extraire la liste depuis le CSV validé,
  vérifier transposition CH, ajouter au lexique v1.1.0 si pertinent.

### 8.3 Stations BBN (briser une mauvaise nouvelle) — candidates `directives_anticipees`

* RESCOS-7, RESCOS-8 et autres stations BBN soulèvent implicitement
  les questions de directives anticipées (art. 370 CC), de
  représentation thérapeutique (art. 378 CC), et de l'intervention
  pour personne incapable de discernement (art. 377-381 CC).
* **Action Phase 7** : décider si une 5e catégorie
  `directives_anticipees` est dans le scope ECOS Suisse, ou si elle
  reste hors lexique pédagogique.

### 8.4 Stations téléconsultation — responsabilité médicale

* USMLE Triage 36/37/38/40 et plusieurs autres scénarios sont
  explicitement téléconsultation. La responsabilité du médecin en
  téléconsultation (informations limitées, orientation aux urgences,
  documentation) est un sujet médico-légal CH émergent.
* **Action Phase 7+** : à arbitrer (catégorie à part entière ou
  enrichissement transversal des cas existants).

### 8.5 Doublon RESCOS-64

* `Patient_RESCOS_4.json` contient deux entrées avec le même shortId
  `RESCOS-64` (« Station double 1 » / « Station double 2 »). Héritage
  Phase 4. Tests dédupent sur shortId, donc pas de bug runtime, mais
  c'est une dette à régulariser.
* **Action Phase 7** : choisir laquelle des deux est canonique
  (probablement « Station double 2 » qui a `medicoLegalReviewed: true`
  en J2), supprimer l'autre, ré-aligner les compteurs si nécessaire.

### 8.6 6e axe scoring `medico_legal`

* L'évaluateur Phase 5 J2 (`legalEvaluator.ts`) produit un score
  médico-légal isolé (`/api/evaluation/legal`), mais il **n'est pas
  intégré** au scoring 5-axes Phase 2/3 (`anamnese`, `examen`,
  `management`, `cloture`, `communication`).
* **Action Phase 7** : décider si le 6e axe `medico_legal` rejoint
  le score global pondéré (Phase 5 J3 invariant N° 1 ZÉRO modif
  scoring serait alors levé).

## 9. Recommandations Phase 7

Cadrage suggéré pour Phase 7, à valider en début de phase :

1. **Lexique v1.1.0** : ouvrir une 4e catégorie `violence_sexuelle_adulte`
   (LAVI étendu, art. 189-190 CP, certificat médical à fin de preuve,
   consentement à la documentation) et annoter USMLE-9.
2. **Lexique v1.1.0 (suite)** : évaluer 5e catégorie
   `capacite_discernement` (art. 16 CC, art. 443a CC) et balayer les
   stations psy candidates.
3. **6e axe scoring** : intégrer le score médico-légal au global
   pondéré, avec poids configurable et A/B opt-in (préserver Phase
   2/3 pour stations sans `legalContext`).
4. **Nettoyage RESCOS-64 doublon** : régulariser la fixture (1 seule
   entrée canonique).
5. **Refonte du `triage-output/README.md`** : pointer vers ce bilan
   et `medico-legal-CH-reference-v1.md` plutôt que vers Phase 6
   exclusivement.
6. **Boot guard étendu** : garde-fou « toute station avec
   `legalContext` doit aussi avoir `medicoLegalReviewed: true` » au
   boot du catalogue (actuellement seulement testé en CI, pas verrouillé
   au boot).

---

*Document figé en clôture Phase 6 (commit J3). Mises à jour ultérieures
via Phase 7 J0 (cadrage) ou refactoring documentaire ciblé.*
