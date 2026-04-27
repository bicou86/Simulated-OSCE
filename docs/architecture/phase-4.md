# Phase 4 — Compose multi-profils

> Cartographie de la composition multi-interlocuteurs (patient + accompagnant·e
> qui parlent l'un et l'autre dans la même station). État post-J4 sur
> `phase-4-multi-profils`. 5 stations pilotes annotées, runtime entièrement
> branché, UX dual-speaker disponible.

## a) Pourquoi multi-profils

Une partie des stations OSCE/ECMO mettent en présence **deux interlocuteurs**
distincts dans la même consultation : un·e adolescent·e et son parent, un·e
patient·e en fin de vie et son accompagnant·e principal·e, un·e nourrisson
pré-verbal·e et le parent qui le présente. Avant Phase 4, le pipeline ne
pouvait modéliser qu'**un seul interlocuteur** (résolu statiquement via
`patientInterlocutor.resolveInterlocutor` : `self` ou `parent`). Le candidat
ne pouvait donc pas s'adresser tour à tour à l'un puis à l'autre — un
défaut majeur sur les ~10 % de stations construites autour d'une asymétrie
de connaissance entre patient·e et tiers (gynéco confidentialité, palliatif,
pédiatrie locomoteur, …).

Phase 4 introduit **un schéma additif** `participants[]` au niveau de la
station, **un routeur d'adresse heuristique** qui tranche à chaque tour qui
parle, **un cloisonnement runtime** des données patient par profil, et une
**UX dual-speaker** côté client (badge + boutons + avatars).

Aucune des 280+ stations mono-patient historiques n'est touchée — la
rétrocompat est verrouillée par le snapshot SHA-256
`tests/fixtures/__snapshots__/phase2-checksum.json` et par les 7 tests E2E
HTTP dans `registerRoutes.test.ts`.

## b) Schéma — `shared/station-schema.ts`

```ts
export const participantSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["patient", "accompanying", "witness"]),
  name: z.string().min(1),
  age: z.number().int().nonnegative().optional(),
  vocabulary: z.enum(["medical", "lay"]),
  knowledgeScope: z.array(z.string().min(1)),
});

export const stationSchema = z
  .object({
    id: z.string().min(1),
    participants: z.array(participantSchema).optional(),
    participantSections: z
      .record(z.string().min(1), z.array(z.string().min(1)).min(1))
      .optional(),
  })
  .passthrough();
```

Trois champs additifs sur la station :

- **`participants[]`** (J1) — chaque profil joué par le LLM, son rôle, son
  registre lexical, et la liste de tags (`knowledgeScope`) qui décrit ce
  qu'il est censé connaître.
- **`participantSections`** (J3) — table de règles de cloisonnement.
  Chaque clé est un **chemin pointé** dans le JSON station (top-level ou
  `a.b`), chaque valeur est la liste de tags requis. Un participant voit la
  section si SON `knowledgeScope` intersecte la liste. Sections non listées
  ⇒ visibles à tous (rétrocompat).
- **`vocabulary`** sur chaque participant — `'lay'` (grand public) ou
  `'medical'`. Pilote l'injection d'une directive lexicale au prompt.

## c) Routeur d'adresse — `server/services/addressRouter.ts`

À chaque tour, `routeAddress({ message, participants, currentSpeaker })`
retourne `{ targetId, confidence, reason, candidateIds? }` — décision
**100 % heuristique**, table de patterns statique, zéro LLM.

Ordre de priorité :

| Stratégie | Exemple | Confidence |
|---|---|---|
| **a) Tag explicite** `[À X] …` | `[À Maman] vous avez remarqué ?` | high |
| **b/c) Vocatif / préfixe rôle** dans la zone avant la première ponctuation | `Maman, depuis quand ?` / `Monsieur Bettaz` | high (proper) / medium (rôle seul) |
| **d) Bascule** « Et vous ? » / « Et de votre côté ? » | `Et vous ?` (current=emma) ⇒ mère | medium |
| **e) Sticky** | aucun marqueur + currentSpeaker valide | low |
| **f) Fallback mono-patient** | un seul participant déclaré | high |

Dérivation des tokens d'adresse :

- **Préfixe relationnel** dans le nom (« Mère / Maman / Père / Papa /
  Parent ») ⇒ tokens de rôle (`maman, mere, madame` ou `papa, pere,
  monsieur`), pas d'extraction de noms propres (sinon « delacroix »
  matcherait à la fois Emma et Mère d'Emma).
- **Préfixe honorifique** (« M. Louis Bettaz », « Mme Borloz ») ⇒ titre
  ajouté en token rôle (`monsieur` / `madame`) + extraction des noms
  propres sur le reste.
- Sinon : prénom + nom + combo prénom-nom.

Ambiguïté ⇒ `targetId = null`, `confidence = "ambiguous"`, le serveur
renvoie un payload `clarification_needed` SANS appeler le LLM. L'UI affiche
`<ClarificationPanel>` avec un bouton par participant.

## d) Cloisonnement runtime — `filterStationByScope`

Le filtre s'exécute dans `buildSystemPrompt` quand un `target` est passé.

```
station JSON → JSON.parse(JSON.stringify(...))
            → strip 7 meta-fields (id, tags, register, patient_age_years,
                                   source_scenario, participants,
                                   participantSections)
            → walk participantSections rules :
                section path → required tags
                if (target.knowledgeScope ∩ requiredTags == ∅) ⇒ delete path
            → return cloned filtered station
            → JSON.stringify in <station_data> block of system prompt
```

**Pourquoi le strip systématique des meta-fields ?** Phase 4 J3 a buté sur
RESCOS-70 où le pitch leakait par 3 chemins NON couverts par
participantSections :

- `id = "RESCOS-70 - Contraception cachée + effets secondaires - Adolescente 16 ans"`
- `tags = ["adolescent","contraception","gyneco","effets-secondaires-pilule"]`
- `participants[].knowledgeScope` (qui contient le mot « contraception » comme tag littéral)

Le strip global les neutralise — l'identité du participant cible est déjà
injectée séparément via le bloc `## TU INCARNES`.

**Validation au boot** (`stationsService.validateMultiProfileStations`) :
toute station avec `participantSections` est traversée. Pour chaque règle :

- le chemin doit exister dans le JSON (sinon la règle est silencieuse) ;
- chaque tag listé doit être couvert par ≥ 1 participant (sinon la
  section reste invisible à tous, ce qui n'est jamais intentionnel).

Erreurs agrégées et `throw` en bloc — l'opérateur voit d'un coup tout ce
qui ne va pas, plutôt que de boucler boot-après-boot.

## e) Vocabulaire `lay` — `server/lib/vocabularyConstraints.ts`

Table statique de **35 termes médicaux** + leur équivalent grand public,
organisée par sphère (respiratoire, urinaire, neuro, digestif, pédiatrie
locomoteur, cardio, général). Couvre les pivots des 3 scénarios canoniques
J3 + les marqueurs lexicaux récurrents des fixtures Phase 2/3.

```ts
{ forbidden: "dyspnée",  pattern: /…/u, layAlternative: "essoufflement / je manque d'air" },
{ forbidden: "asthénie", pattern: /…/u, layAlternative: "fatigue intense" },
{ forbidden: "boiterie d'esquive", pattern: /…/u, layAlternative: "elle évite de poser le pied" },
…
```

`buildLayVocabularyDirective()` est injecté dans le system prompt de tout
participant `vocabulary === 'lay'`. Format ❌→✅ énumératif que le LLM
respecte en pratique (cf. tests E2E gated `RUN_LLM_INTEGRATION=1`).

`detectLayLeaks(reply)` est utilisé côté tests E2E pour asserter au
mot-pour-mot l'absence de jargon dans une réponse réelle. Le pattern
RegExp est unicode-safe (`\p{L}` boundaries) pour gérer accents/pluriels
sans faux-positifs (« anesthésie » ne déclenche pas « asthénie »).

## f) UX dual-speaker — `client/src/components/`

| Composant | Rôle | Visible si |
|---|---|---|
| `CurrentSpeakerBadge.tsx` | Badge persistant « Vous parlez à : NOM (X ans) — patient·e/accompagnant·e » | `participants.length ≥ 2` |
| `SpeakerSwitchButtons.tsx` | « Parler à NOM » par participant + raccourci Tab | `participants.length ≥ 2` |
| `ClarificationPanel.tsx` | Panneau « À qui parlez-vous ? » avec boutons profils | `pendingClarification ≠ null` |

Avatars dérivés via `participantAvatar(p)` (déterministe, pas de table
custom — emojis Unicode, licence libre) :

| Profil | Avatar |
|---|---|
| patient < 2 ans | 👶 |
| patient < 12 ans | 🧒 |
| patient 12-59 ans | 🧑 |
| patient ≥ 60 ans | 👴 |
| accompanying nom commence par « Mère / Maman » | 👩 |
| accompanying nom commence par « Père / Papa » | 👨 |
| accompanying nom commence par « Parent » | 🧑‍🤝‍🧑 |
| witness / défaut | 🧑 |

Couleur d'accent par rôle (`participantAccentClass`) : patient = bleu,
accompagnant = vert, témoin = ambre.

Footer `— NOM` sous chaque bulle de réponse côté patient (multi-profils
uniquement) ⇒ l'enseigné voit immédiatement qui a parlé même en relisant
l'historique.

## g) Stations pilotes annotées (5/5)

| ID | Default speaker | Cloisonnement | Rationale |
|---|---|---|---|
| **RESCOS-70** | emma | ✓ 10 règles | Trifecta canon B1 — pilule cachée à la mère. La mère NE doit JAMAIS révéler Cerazette/désogestrel/contraception/spotting. |
| **RESCOS-71** | martine | ✓ 1 règle (consignes_jeu) | Patient muet (Louis 78 ans, terminal). Martine relaie. |
| **RESCOS-9b** | parent | ✗ aucun | Pédiatrie locomoteur — bébé pré-verbal, tout passe par le parent. Aucun secret asymétrique. Format JSON antérieur (pas de consignes_jeu/motif_cache). |
| **RESCOS-13** | patient | ✗ aucun | Dépression jeune adulte 20 ans — la mère apporte un éclairage comportemental, pas un secret. |
| **RESCOS-63** | parent | ✗ aucun | Toux nourrisson 5 mois — bébé pré-verbal. |

Verrou de non-régression : `server/__tests__/fixturesPilotes.test.ts`
asserte la cohérence (default speaker, présence/absence de cloisonnement,
couverture des tags) sur les 5 pilotes au boot du test.

## h) Anti-patterns (à éviter quand on annote une nouvelle station)

- **Noms ambigus partagés** : `M. Louis Bettaz` + `Mme Bettaz` partagent
  « Bettaz » dans leurs proper-tokens ⇒ « Madame Bettaz » devient ambigu.
  Préférer prénom complet pour un des deux, ou un titre explicite (« Mme »
  vs « M. ») dans le nom.
- **Scopes trop larges** : `knowledgeScope: ["full"]` sur tous les
  participants ⇒ aucun cloisonnement effectif. Préférer une taxonomie
  domain-specific (`sexual_health`, `caregiver_burden`, `school`, …).
- **Tags référencés mais non couverts** : règle `participantSections`
  pointant vers un tag qu'aucun participant ne porte ⇒ section invisible
  à tous. Le validateur boot bloque, mais soyez vigilant en pre-commit.
- **Path inexistant** : règle `histoire_actuelle.foobar` quand la station
  n'a pas ce sous-champ ⇒ règle silencieuse. Le validateur boot bloque
  également.
- **Confiance T0 sans default** : sur multi-profils sans `defaultSpeakerId`,
  le routeur ambigu retourne `clarification_needed` au tout premier tour
  ⇒ l'UI bloque l'enseigné. Toujours fournir un default cohérent (cf.
  `computeDefaultSpeakerId` dans `patientService`).

## i) Comment annoter une nouvelle station multi-profils

1. **Décrire les 2 profils** dans `participants[]` :

   ```json
   "participants": [
     {
       "id": "ado",
       "role": "patient",
       "name": "Léa Martin",
       "age": 15,
       "vocabulary": "lay",
       "knowledgeScope": ["identité", "symptômes", "secret_axis_1"]
     },
     {
       "id": "mother",
       "role": "accompanying",
       "name": "Mère de Léa Martin",
       "vocabulary": "lay",
       "knowledgeScope": ["identité", "symptômes_observés", "antécédents_familiaux"]
     }
   ]
   ```

2. **Identifier les sections sensibles** (`grep` les mots-clés du secret
   dans le JSON station) puis tagger :

   ```json
   "participantSections": {
     "histoire_actuelle.symptomesAssocies": ["secret_axis_1"],
     "antecedents.gyneco": ["secret_axis_1"],
     "consignes_jeu": ["full_scenario"]
   }
   ```

3. **Vérifier le validateur boot** : `npm run dev` doit démarrer sans
   `Validation Phase 4 J3 échouée`.

4. **Vérifier le cloisonnement au prompt-level** : ajouter une suite
   dans `runtimeFiltering.test.ts` ou `trifectaPromptCloisonnement.test.ts`
   asserttant que le profil non autorisé ne reçoit pas les mots-clés
   du secret dans `<station_data>`.

5. **Optionnel** : test E2E LLM gated (`tests/integration/`) avec 5
   essais et `detectLayLeaks` pour vérifier que le LLM tient le
   cloisonnement en pratique.

## j) Tests verrous

- `server/__tests__/stationSchema.test.ts` — validation Zod additive (J1)
- `server/__tests__/addressRouter.test.ts` — 35 tests routeur (J2)
- `server/__tests__/addressRouterIntegration.test.ts` — 12 tests pipeline runtime (J2)
- `server/__tests__/knowledgeScopeFilter.test.ts` — filtre par scope (J3)
- `server/__tests__/vocabularyConstraints.test.ts` — table lay (J3)
- `server/__tests__/multiProfileValidation.test.ts` — validateur boot (J3)
- `server/__tests__/trifectaPromptCloisonnement.test.ts` — cas RESCOS-70 prompt-level (J3)
- `server/__tests__/runtimeFiltering.test.ts` — leaks runtime sans mock (J3 fix)
- `server/__tests__/fixturesPilotes.test.ts` — audit déclaratif des 5 pilotes (J4)
- `server/__tests__/registerRoutes.test.ts` — E2E HTTP `/api/patient/:id/brief` (J2 fix)
- `client/src/components/CurrentSpeakerBadge.test.tsx` — badge dual-speaker (J4)
- `client/src/components/SpeakerSwitchButtons.test.tsx` — boutons + Tab cycle (J4)
- `client/src/components/ClarificationPanel.test.tsx` — UI clarification (J2)
- `client/src/lib/preferences.test.ts` — `participantSpeakerLabel` (J2)
- `tests/integration/phase4-j3-cloisonnement.test.ts` — gated LLM E2E (J3)
