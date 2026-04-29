# Référence pédagogique — Cadre médico-légal suisse v1.0.0

> **Document pédagogique non contraignant.** Ce texte ne constitue
> pas un avis juridique professionnel. Il est destiné aux étudiants en
> médecine utilisateurs de la plateforme OSCE Sim ainsi qu'aux
> contributeurs du corpus. Pour toute application clinique, se référer
> au médecin cantonal, au juriste FMH, à un avocat, ou aux textes de
> loi originaux publiés sur [admin.ch](https://www.admin.ch/).
>
> Les articles de loi sont cités par numéro et brièvement résumés.
> Aucun extrait textuel intégral n'est reproduit (respect du droit
> d'auteur sur les codifications).

## Sommaire

1. [Pourquoi un lexique fermé v1.0.0 ?](#1-pourquoi-un-lexique-fermé-v100)
2. [Catégorie 1 — `secret_pro_levee`](#2-catégorie-1--secret_pro_levee)
3. [Catégorie 2 — `signalement_maltraitance`](#3-catégorie-2--signalement_maltraitance)
4. [Catégorie 3 — `certificat_complaisance`](#4-catégorie-3--certificat_complaisance)
5. [Tableau récapitulatif des stations annotées](#5-tableau-récapitulatif-des-stations-annotées)
6. [Glossaire des termes CH](#6-glossaire-des-termes-ch)
7. [Sources et références publiques](#7-sources-et-références-publiques)

---

## 1. Pourquoi un lexique fermé v1.0.0 ?

L'évaluation médico-légale par GPT/LLM ouvert est un risque
pédagogique : le modèle peut inventer un article de loi, transposer
un cadre nord-américain (HIPAA, mandated reporter US) au lieu du
cadre suisse, ou produire une décision juridiquement erronée mais
plausible.

La plateforme adopte donc un **lexique fermé**, déterministe, où
chaque catégorie est :

* explicitement bornée par 1-N articles du Code pénal (CP), du Code
  civil (CC), du Code de déontologie médicale (CDM-FMH), de la loi
  sur l'aide aux victimes (LAVI), ou du Code des obligations (CO) ;
* dotée d'une **décision attendue** standardisée (`report` /
  `no_report` / `defer` / `refer` / `decline_certificate`) ;
* couverte par un lexique de patterns regex (cf.
  [`server/lib/legalLexicon.ts`](../server/lib/legalLexicon.ts)) qui
  détecte sans LLM les concepts que le candidat doit verbaliser ou
  éviter ;
* protégée par un boot guard qui rejette toute fixture référençant
  un code non mappé.

La v1.0.0 contient **3 catégories** validées en Phase 5 et
maintenues figées en Phase 6. Phase 7 prévoit une extension v1.1.0
(cf. [`docs/phase-6-bilan.md` § 8](./phase-6-bilan.md#8-dette-technique-reportée-phase-7)).

---

## 2. Catégorie 1 — `secret_pro_levee`

**Définition pédagogique** — Situations où le candidat doit identifier
qu'un secret professionnel (art. 321 CP) protège la confidentialité
de la consultation, MAIS où une circonstance objective autorise (sans
imposer) sa **levée** : danger imminent pour autrui, faits dont la
divulgation est dans l'intérêt vital du patient, ou délivrance d'un
certificat à fin de preuve à la demande de la patiente elle-même.

Le piège pédagogique typique : la patiente refuse explicitement le
dépôt de plainte ou le signalement. Le candidat doit **respecter son
autonomie** tout en restant disponible pour orienter (LAVI) et
documenter (constat médical descriptif) — sans rien imposer.

### Bases légales suisses

| Code | Objet |
|---|---|
| **CP-321** | Secret professionnel — règle de confidentialité du médecin (sanction pénale en cas de violation injustifiée). |
| **CP-364** | Droit d'aviser (et non devoir) en cas d'infraction commise contre un mineur, un adulte vulnérable ou un proche dépendant. |
| **LAVI art. 1** | Loi fédérale sur l'aide aux victimes d'infractions — droit de la victime à un soutien gratuit (centres LAVI cantonaux), indépendamment du dépôt de plainte. |

### Décision attendue : `refer`

* Reconnaître le cadre juridique (secret pro, droit vs devoir d'aviser).
* Respecter l'autonomie de décision de la patiente (pas d'imposition
  de plainte).
* Proposer un **constat médical descriptif** à fin de preuve, à
  conserver dans le dossier ou remettre à la patiente.
* Orienter vers les **ressources LAVI** (centres d'aide aux victimes,
  foyers, soutien psychologique).
* Maintenir la confidentialité par défaut (sauf danger imminent
  caractérisé qui imposerait un signalement).

### Anti-patterns (`candidate_must_avoid`)

* Promettre une « confidentialité absolue sans nuance » — incorrect
  car CP-364 prévoit explicitement un droit d'aviser, et un danger
  imminent pour un tiers peut imposer le signalement.
* **Imposer le dépôt de plainte** (« vous devez absolument porter
  plainte ») — viole l'autonomie ; la décision appartient à la victime.
* **Signaler à l'insu de la patiente** sans danger imminent — viole
  CP-321 sans base légale de levée.
* Minimiser les faits ou les ecchymoses (« c'est pas si grave »,
  « juste des bleus ») — communication défaillante.
* Utiliser un terme banalisant (« dispute conjugale », « petite
  engueulade ») — euphémisation des violences.

### Station annotée

[**AMBOSS-24**](../server/data/patient/Patient_AMBOSS_2.json) — Femme 30
ans, évaluation après chute, suspicion de violence domestique. Refus
explicite de plainte. Décision : refer LAVI + constat médical
descriptif + respect autonomie.

---

## 3. Catégorie 2 — `signalement_maltraitance`

**Définition pédagogique** — Situations où le candidat doit identifier
un **devoir de signalement** (et non un simple droit) à l'autorité
de protection (APEA — Autorité de protection de l'enfant et de
l'adulte), parce qu'un mineur ou un adulte vulnérable est exposé à un
danger sérieux. Le secret professionnel **cède** ici devant l'intérêt
supérieur de l'enfant ou la protection de la personne incapable de
discernement.

L'erreur pédagogique typique : confondre **droit d'aviser** (CP-364,
adultes capables) et **devoir d'aviser** (CP-364bis, mineurs en
contact professionnel). En présence d'un mineur exposé, l'inaction
est fautive — disciplinaire (CDM-FMH) et potentiellement pénale.

La transparence avec le parent / la patiente reste due : on annonce
qu'un signalement va être fait, on explique le pourquoi, on
documente. On ne signale **pas dans le dos**.

### Bases légales suisses

| Code | Objet |
|---|---|
| **CP-321** | Secret professionnel (rappel — fait l'objet d'une levée explicite). |
| **CP-364** | Droit d'aviser (cas adultes). |
| **CP-364bis** | **Devoir d'aviser** pour les professionnels en contact avec des mineurs (en vigueur depuis 2019). |
| **CC-307** | Mesures de protection de l'enfant (curatelle, retrait de garde, placement). |
| **CC-314c** | Signalement à l'APEA pour la protection d'un mineur. |
| **CC-443a** | Signalement à l'APEA pour adulte vulnérable (capacité de discernement insuffisante). |
| **LAVI art. 1** | Droit de la patiente / de la mère à un soutien LAVI (foyer, accompagnement). |

### Décision attendue : `report`

* Reconnaître le devoir de signalement (CP-364bis si mineur, ou
  CC-443a si adulte vulnérable).
* **Informer la patiente / le parent** du signalement à venir
  (transparence — pas de signalement à l'insu).
* **Documenter** rigoureusement les indices (verbatims, observations
  cliniques, comportement de l'enfant, contexte familial).
* **Orienter** :
  * Pédiatre / urgences pour évaluation physique (en cas de cas
    téléphonique ou de doute clinique).
  * Foyer d'accueil + LAVI pour la patiente adulte exposée.
* Adopter une posture de **non-jugement et soutien**, validation de
  la démarche de la patiente / du parent qui a osé en parler.

### Anti-patterns (`candidate_must_avoid`)

* **Promettre de ne rien signaler** malgré la présence d'un mineur en
  danger — viole CP-364bis et CDM.
* **Signaler dans le dos** de la patiente / du parent (« à son insu »,
  « sans la prévenir ») — viole l'éthique de transparence.
* **Blâmer la patiente** pour son inaction (« vous auriez dû partir
  plus tôt », « c'est de votre faute ») — communication non-soutenante.
* Culpabiliser le retour au domicile (« si vous rentrez, c'est de
  votre faute ») — coercition.
* **Imposer un dépôt de plainte immédiat** — la plainte est une
  décision séparée du signalement APEA.

### Stations annotées

* [**USMLE-34**](../server/data/patient/Patient_USMLE_2.json) — Femme 32
  ans, fatigue + violence domestique avec enfants exposés. Devoir de
  signalement APEA pour les enfants ; LAVI + foyer pour la patiente.
* [**USMLE Triage 39**](../server/data/patient/Patient_USMLE_Triage_2.json)
  — Cas téléphonique, suspicion de maltraitance d'une mineure de
  3 ans (Joey, fille de l'appelante Kelly). Signalement APEA + organisation
  d'une consultation pédiatrique physique en urgence.

---

## 4. Catégorie 3 — `certificat_complaisance`

**Définition pédagogique** — Situations où le patient demande un
certificat médical (typiquement un arrêt de travail) pour des raisons
qui ne correspondent **pas** à une incapacité de travail médicalement
fondée. Le candidat doit identifier le **risque pénal et
disciplinaire** d'un certificat de complaisance, refuser **avec
explication du cadre légal**, et préserver la relation
thérapeutique en proposant des alternatives non frauduleuses.

L'erreur pédagogique typique : céder « pour cette fois » par
empathie, sans réaliser que le certificat de complaisance est un
**faux dans les titres** (CP-318) et expose à une sanction
disciplinaire FMH (CDM art. 34). À l'inverse, un refus brutal et
moralisateur sans cadre rompt la relation thérapeutique sans bénéfice
pédagogique pour le patient.

### Bases légales suisses

| Code | Objet |
|---|---|
| **CP-318** | Faux dans les titres délivrés par certaines personnes — sanction pénale du certificat médical mensonger. |
| **CDM art. 34 (FMH)** | Code de déontologie médicale FMH — interdit la délivrance de certificats inexacts ou de complaisance. Sanction disciplinaire (avertissement, blâme, amende, retrait FMH). |
| **CO art. 324a** | Code des obligations — paiement du salaire en cas d'empêchement (incapacité médicale réelle). Cadre que le certificat doit refléter fidèlement. |

### Décision attendue : `decline_certificate`

* Refus **motivé** du certificat (« je ne peux pas vous délivrer ce
  certificat »).
* **Explicitation du cadre légal** : faux dans les titres (CP-318),
  responsabilité disciplinaire FMH/CDM.
* **Validation empathique** de la difficulté du patient (« je
  comprends, c'est une situation difficile »).
* Proposition d'**alternatives non frauduleuses** : congés sans solde,
  dialogue avec l'employeur / RH, médiation, prise en charge
  d'épuisement réel si applicable.
* **Préservation de la relation thérapeutique** : « on peut continuer
  le suivi », « revenez si la situation évolue ».

### Anti-patterns (`candidate_must_avoid`)

* **Émettre le certificat « pour cette fois »** ou
  « exceptionnellement » — fait pénal/disciplinaire indépendamment de
  la fréquence.
* **Refuser sans expliquer le cadre légal** — refus brutal qui rompt
  la relation et n'a pas de valeur pédagogique pour le patient.
* **Moraliser ou juger** le patient (« vous mentez », « c'est
  malhonnête », « vous devriez avoir honte ») — incompatible avec
  l'éthique relationnelle.
* **Menacer de signaler le patient** à son employeur — viole CP-321 et
  est dénué de base légale.
* **Rompre la relation** thérapeutique abruptement (« ne revenez plus »,
  « cette consultation est terminée », « sortez »).

### Station annotée

[**RESCOS-72**](../server/data/patient/Patient_RESCOS_4.json) — Demande
d'arrêt de travail abusif. Patient en burnout léger qui demande
explicitement un certificat alors que les critères médicaux ne sont
pas réunis. Décision : decline_certificate + explicitation CP-318/CDM
+ alternatives.

---

## 5. Tableau récapitulatif des stations annotées

| ID | Catégorie | Décision | Lois invoquées | Subject status | Phase |
|---|---|---|---|---|---|
| AMBOSS-24 | `secret_pro_levee` | `refer` | CP-321, CP-364, LAVI-art-1 | adult_capable | 5 J1 |
| USMLE-34 | `signalement_maltraitance` | `report` | CP-321, CP-364, CP-364bis, CC-307, CC-314c | adult_capable | 5 J1 |
| RESCOS-72 | `certificat_complaisance` | `decline_certificate` | CP-318, CDM-FMH-art-34, CO-art-324a | adult_capable | 5 J1 |
| USMLE Triage 39 | `signalement_maltraitance` | `report` | CP-321, CP-364, CP-364bis, CC-307, CC-314c | minor | 6 J2 |

---

## 6. Glossaire des termes CH

| Terme | Définition |
|---|---|
| **APEA** | Autorité de protection de l'enfant et de l'adulte. Instance cantonale qui ordonne les mesures de protection (curatelle, placement, retrait de garde). Successeur de l'ancienne « autorité tutélaire ». Reçoit les signalements CC-314c (mineurs) et CC-443a (adultes vulnérables). |
| **CC** | Code civil suisse — droit de la famille, protection de la personnalité, mesures de protection. |
| **CDM** | Code de déontologie médicale (FMH). Charte que tout médecin membre de la FMH s'engage à respecter ; sanctions disciplinaires en cas de violation. |
| **CO** | Code des obligations — droit du contrat de travail, dont l'art. 324a (salaire en cas d'empêchement). |
| **CP** | Code pénal suisse. |
| **CP-318** | Faux dans les titres délivrés par certaines personnes — incrimine notamment le certificat médical de complaisance. |
| **CP-321** | Violation du secret professionnel — sanctionne pénalement la divulgation injustifiée. |
| **CP-364** | Droit d'aviser pour les professionnels — autorise (sans imposer) la levée du secret quand un proche est victime. |
| **CP-364bis** | Devoir d'aviser pour les professionnels en contact avec des mineurs — impose le signalement quand un mineur est en danger. En vigueur depuis 2019. |
| **CC-307** | Mesures de protection de l'enfant (curatelle, retrait de garde, placement). |
| **CC-314c** | Signalement à l'APEA pour la protection d'un mineur. |
| **CC-443a** | Signalement à l'APEA pour adulte vulnérable (capacité de discernement insuffisante). |
| **CO art. 324a** | Paiement du salaire en cas d'empêchement non fautif (maladie, accident) — cadre que le certificat médical doit refléter. |
| **FMH** | Foederatio Medicorum Helveticorum — Fédération des médecins suisses. Édite le Code de déontologie médicale (CDM). |
| **LAVI** | Loi fédérale sur l'aide aux victimes d'infractions (Loi sur l'Aide aux VIctimes). Garantit aux victimes un soutien gratuit (centres LAVI cantonaux), indépendant du dépôt de plainte. |
| **PLAFA** | Placement à des fins d'assistance (art. 426 CC) — placement non volontaire pour incapacité aiguë (psychiatrie). Hors v1.0.0 ; candidat Phase 7. |
| **Capacité de discernement** | Art. 16 CC — aptitude à apprécier la portée d'un acte. La capacité de discernement est présumée ; son absence doit être établie. Pivot pour le consentement éclairé et pour les signalements adultes (CC-443a). |
| **Mandated reporter** | Concept anglo-saxon (US) du « professionnel obligé de signaler ». En droit CH, n'a pas d'équivalent général ; CP-364bis crée un devoir analogue limité aux mineurs. **Ne pas transposer mécaniquement** le cadre US au cas CH. |
| **Foyer / maison d'accueil** | Hébergement d'urgence pour personnes victimes de violence. Réseau cantonal soutenu par la LAVI. |
| **Constat médical descriptif (à fin de preuve)** | Document factuel (ecchymoses, lésions, datation présumée, photos) délivré au patient ou conservé au dossier — peut être produit ultérieurement en justice si la victime décide de porter plainte. À distinguer du certificat médical d'incapacité de travail. |

---

## 7. Sources et références publiques

* **admin.ch** — recueil systématique du droit fédéral (CC, CP, CO, LAVI).
* **fmh.ch** — Code de déontologie médicale FMH, fiches éthiques.
* **kokes.ch** — Conférence suisse des autorités de protection de
  l'enfant et de l'adulte (KOKES) — guides APEA cantonaux.
* **lavi-info.ch** — portail public d'information sur la LAVI et
  liste des centres cantonaux.

Pour toute station du corpus impliquant une dimension médico-légale,
le rédacteur (humain) peut compléter le `decision_rationale` en
citant explicitement ces sources publiques. Le LLM patient n'a en
revanche **jamais** accès au `decision_rationale` (cf.
[`META_FIELDS_TO_STRIP`](../server/services/patientService.ts#L429)),
ce qui élimine le risque que la patiente cite spontanément la « bonne »
base légale et fausse l'évaluation.

---

*Document figé en clôture Phase 6 — version 1.0.0. Mises à jour
prévues en Phase 7 J0 si extension lexique v1.1.0 (cf. [`docs/phase-6-bilan.md` § 8](./phase-6-bilan.md#8-dette-technique-reportée-phase-7)).*
