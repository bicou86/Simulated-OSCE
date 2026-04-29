# Phase 7 J3 — Notes process & arbitrages

## 1. Annotation USMLE-9 — choix `violence_sexuelle_adulte`

USMLE-9 ("Agression sexuelle - Femme de 25 ans") avait été laissée en
status C non-flagged à la clôture Phase 6 J2 (1/287, ce qui crée le
trou de couverture). Le triage J1 l'avait classée C parce que la
catégorie « violence sexuelle adulte » n'existait pas dans le lexique
v1.0.0. Phase 7 J1 a comblé ce trou en ouvrant la catégorie
`violence_sexuelle_adulte` (lexique v1.1.0, 8 must_verbalize +
3 must_avoid déjà couverts par regex). J3 applique l'annotation à
USMLE-9.

**Catégorie retenue** : `violence_sexuelle_adulte` (enum v1.1.0 fermé,
pas de catégorie ad-hoc créée — invariant respecté).

**Subject status** : `adult_capable` (Julia Melton, 25 ans, alerte et
orientée x3, force 5/5 partout, NCC II-XII intacts → discernement
préservé).

**Expected decision** : `refer` (ORIENTER vers kit médico-légal sous 72h
+ LAVI + soutien psychologique + gynéco-obstétrique pour prophylaxie
HIV/IST/contraception d'urgence).

**Mandatory reporting** : `false` (en droit fédéral suisse, AUCUN devoir
d'aviser la police pour un adulte capable victime d'agression sexuelle —
la décision de plainte appartient à la victime).

**Applicable law** : `["CP-321", "LAVI-art-1", "CDM-FMH-art-34"]` —
choix MINIMALISTE qui ne nécessite PAS d'extension de
`LEGAL_LAW_CODE_PATTERNS`. CP-189/190/191 (codes pénaux des infractions
sexuelles) ne sont PAS cités parce que :
1. Ce sont des codes prosécutoriaux, pas médicaux. Le médecin oriente,
   il ne se positionne pas sur la qualification pénale.
2. Les ajouter exigerait d'étendre `LEGAL_LAW_CODE_PATTERNS` (sinon le
   boot guard `validateLegalContextLawCodes` throw).
3. Le cadre médical est suffisant : CP-321 (secret pro qui PROTÈGE la
   patiente), LAVI-art-1 (orientation aide aux victimes), CDM-FMH-art-34
   (déontologie professionnelle, écoute non-jugeante).

**Invariants respectés** :
- Aucune des 286 stations existantes hors USMLE-9 n'est touchée (preuve
  via Test "violence_sexuelle_adulte n'est consommée que par USMLE-9 (1
  occurrence)").
- USMLE-9 brief HTTP byte count = 509 bytes (pre-J3 et post-J3 strictement
  identiques : `legalContext` est strippé via META_FIELDS_TO_STRIP).
  Cette valeur fixe la nouvelle baseline.
- `LEGAL_LEXICON_VERSION` reste à `1.1.0` (aucun bump).

## 2. Mea culpa Phase 7 J2 — substitution silencieuse de RESCOS-70

En J2, j'ai substitué RESCOS-70 → RESCOS-7 dans le Test A de
`phase7J2SixthAxis.test.ts` avec la justification "n'existe pas dans le
corpus". **Cette justification était fausse**.

**Cause racine** : j'avais grep `stations_index.json` (legacy, incomplet)
au lieu de vérifier via `getStationMeta` après `initCatalog()` —
qui est la SOURCE DE VÉRITÉ du catalogue runtime construit depuis les
14 fichiers `Patient_*.json`. RESCOS-70 existe bel et bien :
`Patient_RESCOS_4.json` ligne 5075, "Contraception cachée + effets
secondaires - Adolescente 16 ans", `stationType=anamnese_examen`,
`hasLegalContext=false`.

**Process à appliquer désormais** : ne plus jamais conclure « ID
inexistant » sur la base d'un grep dans un fichier d'index. Toujours
vérifier via `getStationMeta(id)` après `initCatalog()` AVANT de
substituer ou skip. Si `getStationMeta` renvoie undefined, lever la
main au lieu de substituer en silence.

**Correctif J3** : Test A étendu de 5 à 6 stations témoins. RESCOS-70
réintégrée avec ses scores synthétiques propres (anamnese=70, examen=80,
management=90, cloture=70, communication=30 → snapshot=78, anamnese_examen
formula). RESCOS-7 (BBN) et USMLE-8 (Suivi diabète) sont conservées
comme couverture additionnelle (diversification station_type +
thématique diabète type 2). Patient_Type_2_Diabetes reste hors corpus
(c'est un filename pattern user-listé, pas un station_id valide) —
USMLE-8 demeure un substitut accepté.

## 3. Endpoint debug `/api/debug/evaluation-weights`

Préparation UI Evaluation J4 + vérifs runtime Claude Chrome. Garde
`NODE_ENV === "production"` → 404 indistinguable (pas de surface en
prod). Réponse JSON minimaliste : `{stationId, hasLegalContext,
stationType, weights: AxisWeights6, sumWeights}` — aucun score, aucun
transcript, pas de fuite legalContext (uniquement le booléen de
présence, pas le contenu).

## 4. Hot-reload Replit (rappel J5)

`tsx watch` ne hot-reload pas en profondeur les modifs de :
- `shared/evaluation-weights.ts`
- `server/routes.ts` (montage de routers)
- `server/routes/debug.ts` (nouveau routeur)
- `server/services/evaluatorService.ts`
- Les fixtures `Patient_*.json` (catalogue chargé une fois au boot)

**Action utilisateur** : kill complet du process Replit (pas Ctrl+C —
killer le workflow et redémarrer) avant tests runtime UI ou Claude
Chrome sur le nouvel endpoint debug.
