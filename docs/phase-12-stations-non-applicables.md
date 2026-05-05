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
