# Phase 8 J5 — Audit corpus stations sans `legalContext` (mini sondage)

> Mini sondage heuristique (lecture seule, **zéro modification de fixture, zéro LLM**) des stations qui n'ont **pas** de `legalContext` dans le corpus, pour identifier d'éventuels candidats prioritaires à une annotation médico-légale future. Cible Phase 8 = **283 stations** (= 288 corpus - 5 stations déjà annotées AMBOSS-24 / USMLE-34 / RESCOS-72 / USMLE Triage 39 / USMLE-9).

> ⚠️ **Hors scope Phase 8** (arbitrage utilisateur F) : ce document **n'est pas une recommandation d'extension du corpus**. C'est uniquement un sondage de priorité pour une décision Phase 9+ qui requerra validation experte humaine.

---

## 1. Méthodologie

Le script [`scripts/audit-282-stations-no-legal.ts`](../scripts/audit-282-stations-no-legal.ts) :

1. **Lecture seule** de toutes les fixtures `Patient_*.json` et `Examinateur_*.json`. Aucun fichier disque n'est modifié (test 1 du fichier de tests).
2. **Filtre** les stations qui ont déjà un `legalContext` (les 5 cf. supra) → exclues du rapport.
3. Pour chaque station restante, **aplatit** récursivement tous les champs textuels (patient narratif + grille évaluateur si elle existe).
4. **Scan keyword** : utilise les `patterns` regex du module [`server/lib/legalLexicon.ts`](../server/lib/legalLexicon.ts) v1.1.0 (Phase 7 J1+J3). **Aucun keyword inventé.** Les `antiPattern` sont ignorés (signaux pédagogiques négatifs, pas indicateurs de pertinence).
5. **Compte** par catégorie médico-légale du lexique (7 catégories actives : `secret_pro_levee`, `signalement_maltraitance`, `certificat_complaisance`, `violence_sexuelle_adulte`, `capacite_discernement`, `directives_anticipees`, `responsabilite_teleconsult`).
6. **`scoreTotal`** = somme de tous les hits sur toutes les catégories (tri primaire). **`categoriesTouched`** = nombre de catégories distinctes avec ≥ 1 hit (tri secondaire conceptuel).

**Idempotence** : 2 runs consécutifs produisent un output identique (test 5).

---

## 2. Distribution par catégorie médico-légale (lexicon v1.1.0)

| Catégorie | Stations avec ≥ 1 hit | Total hits sur le corpus |
|---|---|---|
| `secret_pro_levee` | 51 | 54 |
| `signalement_maltraitance` | 107 | 121 |
| `certificat_complaisance` | 12 | 13 |
| `violence_sexuelle_adulte` | 79 | 86 |
| `capacite_discernement` | 20 | 21 |
| `directives_anticipees` | 7 | 7 |
| `responsabilite_teleconsult` | 120 | 147 |

Stations scannées au total : **288** (5 déjà annotées exclues, **283** auditées).

**Lectures clés** :
- `responsabilite_teleconsult` est la catégorie la plus représentée (120/283 stations, soit 42 %), ce qui s'explique par le grand nombre de stations « cabinet médecine générale » et « consultation téléphonique » qui matchent les patterns telecons (numéros d'urgence, follow-up, conditions de rappel).
- `signalement_maltraitance` (107/283 = 38 %) et `violence_sexuelle_adulte` (79/283 = 28 %) reflètent la présence diffuse de keywords comme « danger », « victim », « violence », « domicile » dans des contextes parfois purement médicaux non médico-légaux.
- `directives_anticipees` (7/283 = 2 %) reste très ciblée — ce sont essentiellement des stations de fin de vie / soins palliatifs.
- `certificat_complaisance` (12/283 = 4 %) capture des stations où le mot « certificat » apparaît dans le narratif sans nécessairement être pédagogiquement pertinent.

---

## 3. Top 30 candidats par `scoreTotal`

Les colonnes par catégorie utilisent ces alias courts :
- `secret_pro` = `secret_pro_levee`
- `signal` = `signalement_maltraitance`
- `cert` = `certificat_complaisance`
- `vsx_adt` = `violence_sexuelle_adulte`
- `discern` = `capacite_discernement`
- `dir_ant` = `directives_anticipees`
- `telecons` = `responsabilite_teleconsult`

| Rang | shortId | source | score | n_cat | secret_pro | signal | cert | vsx_adt | discern | dir_ant | telecons | setting |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | USMLE-6 | USMLE | 7 | 4 | 1 | 3 | · | 2 | · | · | 1 | Cabinet de médecine générale |
| 2 | USMLE Triage 6 | USMLE_Triage | 6 | 5 | 1 | 1 | · | 2 | 1 | · | 1 | Cabinet de médecine générale |
| 3 | USMLE-18 | USMLE | 6 | 4 | 1 | 2 | · | 1 | · | · | 2 | Consultation téléphonique au cabinet |
| 4 | AMBOSS-28 | AMBOSS | 5 | 4 | 1 | 1 | · | · | 1 | · | 2 | Cabinet de médecine générale |
| 5 | AMBOSS-34 | AMBOSS | 5 | 4 | 2 | 1 | 1 | · | · | · | 1 | Clinique de soins urgents |
| 6 | German-3 | German | 5 | 3 | · | 2 | · | 2 | · | · | 1 | Cabinet de pédiatrie |
| 7 | RESCOS-55 | RESCOS | 5 | 5 | 1 | 1 | · | 1 | 1 | 1 | · | Service de médecine interne - Colloqu... |
| 8 | RESCOS-69 | RESCOS | 5 | 3 | 1 | 2 | · | 2 | · | · | · | Urgences d'un hôpital universitaire |
| 9 | RESCOS-8 | RESCOS | 5 | 3 | 1 | 2 | 2 | · | · | · | · | Service des urgences |
| 10 | USMLE Triage 12 | USMLE_Triage | 5 | 3 | · | 2 | · | 2 | · | · | 1 | Cabinet de médecine générale |
| 11 | USMLE-14 | USMLE | 5 | 4 | 1 | · | · | 1 | 1 | · | 2 | Service d'urgences |
| 12 | USMLE-29 | USMLE | 5 | 4 | · | 1 | · | 1 | 1 | · | 2 | Cabinet de médecine générale |
| 13 | USMLE-32 | USMLE | 5 | 5 | 1 | 1 | · | · | 1 | 1 | 1 | Cabinet de médecine générale |
| 14 | USMLE-35 | USMLE | 5 | 4 | 1 | 1 | · | · | 1 | · | 2 | Service d'urgences |
| 15 | USMLE-5 | USMLE | 5 | 4 | 2 | 1 | · | 1 | · | · | 1 | Clinique |
| 16 | German-34 | German | 4 | 4 | · | 1 | · | 1 | 1 | · | 1 | Cabinet de médecine générale |
| 17 | German-70 | German | 4 | 2 | · | 3 | 1 | · | · | · | · | Cabinet de médecine de famille - Gard... |
| 18 | RESCOS-60 | RESCOS | 4 | 4 | 1 | 1 | 1 | · | · | 1 | · | Service de médecine interne |
| 19 | RESCOS-64 | RESCOS | 4 | 3 | · | 1 | · | 1 | · | · | 2 | Cabinet de médecine générale |
| 20 | RESCOS-70 | RESCOS | 4 | 3 | 1 | · | · | 1 | · | · | 2 | Cabinet de médecine générale |
| 21 | RESCOS-71 | RESCOS | 4 | 4 | · | 1 | 1 | 1 | · | 1 | · | Consultation en unité de soins pallia... |
| 22 | USMLE Triage 10 | USMLE_Triage | 4 | 3 | · | 1 | · | 1 | · | · | 2 | Cabinet de médecine générale |
| 23 | USMLE Triage 24 | USMLE_Triage | 4 | 3 | · | 1 | · | 2 | · | · | 1 | Cabinet de médecine générale |
| 24 | USMLE-12 | USMLE | 4 | 3 | 1 | · | · | 1 | · | · | 2 | Cabinet de médecine générale |
| 25 | USMLE-16 | USMLE | 4 | 2 | · | · | · | 2 | · | · | 2 | Cabinet de médecine générale |
| 26 | USMLE-26 | USMLE | 4 | 4 | · | 1 | 1 | 1 | · | · | 1 | Cabinet de médecine générale |
| 27 | USMLE-27 | USMLE | 4 | 4 | · | 1 | · | 1 | 1 | · | 1 | Cabinet de médecine générale |
| 28 | USMLE-33 | USMLE | 4 | 4 | · | 1 | · | 1 | 1 | · | 1 | Cabinet de médecine générale |
| 29 | USMLE-41 | USMLE | 4 | 3 | · | 2 | · | 1 | · | · | 1 | Cabinet de médecine générale |
| 30 | USMLE-7 | USMLE | 4 | 3 | 1 | 1 | · | · | · | · | 2 | Service d'urgences |

> Pour les 253 stations restantes (rangs 31-283), exécuter localement : `npx tsx scripts/audit-282-stations-no-legal.ts --top 283`.

---

## 4. Limites de l'audit (à lire impérativement avant toute décision Phase 9+)

### 4.1 Précision sémantique = 0 %

L'heuristique repose sur un **match keyword pur** via les regex `patterns` du lexique. Elle ne distingue **pas** :
- l'**affirmation** vs la **négation** (« pas de tuberculose » match « tuberculose »),
- le **contexte pédagogique** vs le **contexte narratif neutre** (un patient diabétique dont le cabinet « propose un suivi téléphonique » score sur `responsabilite_teleconsult` même si ce n'est pas l'enjeu pédagogique de la station),
- la **pertinence pédagogique** réelle d'un legalContext (l'évaluateur humain seul peut juger si la station est conçue pour faire travailler un raisonnement médico-légal).

### 4.2 Faux positifs structurels

Les stations « cabinet de médecine générale » avec scénario classique (anamnèse + examen + management médical) matchent souvent `responsabilite_teleconsult` (numéro d'urgence dans la clôture, conditions de rappel) et `signalement_maltraitance` (mots « danger », « victime ») **sans pour autant porter un enjeu médico-légal** au sens Phase 5/7. La majorité du top 30 est sans doute dans ce cas.

### 4.3 `scoreTotal` ≠ priorité d'annotation

Un score élevé indique **présence diffuse de keywords**, pas pertinence pédagogique. La métrique `categoriesTouched` (n_cat) est probablement un meilleur indicateur de stations « multi-axes médico-légaux », mais reste à valider expert.

### 4.4 Couverture lexique limitée

Le lexique v1.1.0 (7 catégories actives) ne couvre pas tous les domaines médico-légaux suisses. Une station avec un enjeu pédagogique non couvert par le lexique actuel scorera 0 et sera invisible dans cet audit.

---

## 5. Recommandation pour Phase 9+

Le présent document **ne recommande pas** d'extension du corpus `legalContext`. Si Phase 9 décide d'étendre la couverture, le processus minimal recommandé est :

1. **Validation experte** des candidats top 30 par un médecin compétent en droit médical CH (pas Claude Code).
2. **Filtrage manuel** des faux positifs structurels (telecons générique, signalement keyword neutre).
3. **Priorisation** par enjeu pédagogique réel (pas par `scoreTotal` algorithmique).
4. **Ajout par batch** (3-5 stations à la fois) avec validation des baselines briefs UTF-8 byte-à-byte préservées (cf. invariants Phase 8 J5).
5. **Mise à jour bilan annuel** : compteur `5/288 → N/288` à chaque batch annoté, conservation de la traçabilité Phase d'origine.

Note : si Phase 9 ne procède PAS à l'extension, ce document reste utile comme **traçabilité de la décision** (« nous avons regardé, voici ce qui aurait pu mériter, on a décidé de pas étendre »).

---

## 6. Reproductibilité

```bash
# Markdown stdout (équivalent à ce document, sections 2-3)
npx tsx scripts/audit-282-stations-no-legal.ts

# JSON brut pour traitement aval
npx tsx scripts/audit-282-stations-no-legal.ts --json

# Top N personnalisé
npx tsx scripts/audit-282-stations-no-legal.ts --top 50
```

Le script est **déterministe** (idempotent sur 2 runs successifs, cf. test 5 dans [scripts/__tests__/audit282StationsNoLegal.test.ts](../scripts/__tests__/audit282StationsNoLegal.test.ts)).

---

## 7. Référence croisée

- Module lexique : [`server/lib/legalLexicon.ts`](../server/lib/legalLexicon.ts) (v1.1.0)
- Catégories actives Phase 7 : [`docs/phase-7-bilan.md`](./phase-7-bilan.md) §3
- Stations annotées (5/288 exclues de cet audit) : AMBOSS-24, USMLE-34, RESCOS-72, USMLE Triage 39, USMLE-9
- Test d'audit : [`scripts/__tests__/audit282StationsNoLegal.test.ts`](../scripts/__tests__/audit282StationsNoLegal.test.ts) (13 tests, lecture seule, idempotence)
