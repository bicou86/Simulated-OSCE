# Référence pédagogique — Cadre médico-légal suisse v2 (lexique v1.1.0)

> **Mise à jour v2 (Phase 7 J1)** — extension du lexique de **3** à
> **7 catégories** par ajout de 4 nouvelles catégories pédagogiques
> CH : `violence_sexuelle_adulte`, `capacite_discernement`,
> `directives_anticipees`, `responsabilite_teleconsult`. Les 3
> catégories Phase 5 sont conservées **inchangées byte-à-byte** (cf.
> snapshot non-régression dans
> [`server/__tests__/legalLexicon.v1.1.0.test.ts`](../server/__tests__/legalLexicon.v1.1.0.test.ts)).
> La version précédente reste accessible :
> [`docs/medico-legal-CH-reference-v1.md`](./medico-legal-CH-reference-v1.md).

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

1. [Pourquoi un lexique fermé v1.1.0 ?](#1-pourquoi-un-lexique-fermé-v110)
2. [Catégorie 1 — `secret_pro_levee`](#2-catégorie-1--secret_pro_levee) *(v1.0.0, inchangée)*
3. [Catégorie 2 — `signalement_maltraitance`](#3-catégorie-2--signalement_maltraitance) *(v1.0.0, inchangée)*
4. [Catégorie 3 — `certificat_complaisance`](#4-catégorie-3--certificat_complaisance) *(v1.0.0, inchangée)*
5. [Catégorie 4 — `violence_sexuelle_adulte`](#5-catégorie-4--violence_sexuelle_adulte) *(nouvelle Phase 7 J1)*
6. [Catégorie 5 — `capacite_discernement`](#6-catégorie-5--capacite_discernement) *(nouvelle Phase 7 J1)*
7. [Catégorie 6 — `directives_anticipees`](#7-catégorie-6--directives_anticipees) *(nouvelle Phase 7 J1)*
8. [Catégorie 7 — `responsabilite_teleconsult`](#8-catégorie-7--responsabilite_teleconsult) *(nouvelle Phase 7 J1)*
9. [Tableau récapitulatif des 7 catégories](#9-tableau-récapitulatif-des-7-catégories)
10. [Tableau récapitulatif des stations annotées](#10-tableau-récapitulatif-des-stations-annotées)
11. [Glossaire des termes CH étendu](#11-glossaire-des-termes-ch-étendu)
12. [Sources et références publiques](#12-sources-et-références-publiques)

---

## 1. Pourquoi un lexique fermé v1.1.0 ?

L'évaluation médico-légale par GPT/LLM ouvert est un risque
pédagogique : le modèle peut inventer un article de loi, transposer
un cadre nord-américain (HIPAA, mandated reporter US) au lieu du
cadre suisse, ou produire une décision juridiquement erronée mais
plausible.

La plateforme adopte donc un **lexique fermé**, déterministe, où
chaque catégorie est :

* explicitement bornée par 1-N articles du Code pénal (CP), du Code
  civil (CC), du Code de déontologie médicale (CDM-FMH), de la loi
  sur l'aide aux victimes (LAVI), du Code des obligations (CO), ou
  des directives ASSM ;
* dotée d'une **décision attendue** standardisée (`report` /
  `no_report` / `defer` / `refer` / `decline_certificate`) ;
* couverte par un lexique de patterns regex (cf.
  [`server/lib/legalLexicon.ts`](../server/lib/legalLexicon.ts)) qui
  détecte sans LLM les concepts que le candidat doit verbaliser ou
  éviter ;
* protégée par un boot guard qui rejette toute fixture référençant
  un code non mappé.

La v1.1.0 couvre **7 catégories** :

* **3 catégories v1.0.0** validées en Phase 5 et figées :
  `secret_pro_levee`, `signalement_maltraitance`,
  `certificat_complaisance`.
* **4 catégories v1.1.0** ajoutées en Phase 7 J1 (couverture
  pédagogique élargie) :
  * `violence_sexuelle_adulte` — prise en charge LAVI +
    médico-légal d'une victime adulte.
  * `capacite_discernement` — évaluation tripartite CC-16 du
    consentement.
  * `directives_anticipees` — recherche / respect / rédaction
    CC-370 et suivants.
  * `responsabilite_teleconsult` — devoirs spécifiques à la
    téléconsultation.

J1 = livraison du **lexique étendu seul** : aucune station n'est
annotée dans ces 4 nouvelles catégories en J1. La station USMLE-9
(agression sexuelle d'une femme de 25 ans, status C reportée Phase 6)
sera annotée en `violence_sexuelle_adulte` lors de Phase 7 J3.

Le scoring **5 axes** Phase 2/3 reste inchangé : la pondération du
6ᵉ axe `medico_legal` à 10 % sera introduite en Phase 7 J2.

---

## 2. Catégorie 1 — `secret_pro_levee`

*v1.0.0 — inchangée Phase 7 J1.*

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
* **Imposer le dépôt de plainte** — viole l'autonomie ; la décision
  appartient à la victime.
* **Signaler à l'insu de la patiente** sans danger imminent — viole
  CP-321 sans base légale de levée.
* Minimiser les faits ou utiliser un terme banalisant.

### Station annotée

* [**AMBOSS-24**](../server/data/patient/Patient_AMBOSS_2.json) — Femme
  30 ans, suspicion violence domestique, refus explicite de plainte.

---

## 3. Catégorie 2 — `signalement_maltraitance`

*v1.0.0 — inchangée Phase 7 J1.*

**Définition pédagogique** — Situations où le candidat doit identifier
un **devoir de signalement** (et non un simple droit) à l'autorité
de protection (APEA — Autorité de protection de l'enfant et de
l'adulte), parce qu'un mineur ou un adulte vulnérable est exposé à un
danger sérieux. Le secret professionnel **cède** ici devant l'intérêt
supérieur de l'enfant ou la protection de la personne incapable de
discernement.

L'erreur pédagogique typique : confondre **droit d'aviser** (CP-364,
adultes capables) et **devoir d'aviser** (CP-364bis, mineurs en
contact professionnel).

### Bases légales suisses

| Code | Objet |
|---|---|
| **CP-321** | Secret professionnel (rappel — fait l'objet d'une levée explicite). |
| **CP-364** | Droit d'aviser (cas adultes). |
| **CP-364bis** | **Devoir d'aviser** pour les professionnels en contact avec des mineurs (en vigueur depuis 2019). |
| **CC-307** | Mesures de protection de l'enfant. |
| **CC-314c** | Signalement à l'APEA pour la protection d'un mineur. |
| **CC-443a** | Signalement à l'APEA pour adulte vulnérable. |
| **LAVI art. 1** | Droit de la patiente / mère à un soutien LAVI. |

### Décision attendue : `report`

* Reconnaître le devoir de signalement (CP-364bis si mineur, CC-443a
  si adulte vulnérable).
* **Informer la patiente / le parent** du signalement à venir
  (transparence).
* **Documenter** rigoureusement les indices.
* **Orienter** : pédiatre / urgences ; foyer + LAVI pour la patiente
  adulte.

### Anti-patterns

* **Promettre de ne rien signaler** malgré un mineur en danger.
* **Signaler dans le dos** sans informer.
* **Blâmer la patiente** pour son inaction.
* **Imposer un dépôt de plainte immédiat** (la plainte est une
  décision séparée du signalement APEA).

### Stations annotées

* [**USMLE-34**](../server/data/patient/Patient_USMLE_2.json) — Femme
  32 ans, fatigue + violence domestique avec enfants exposés.
* [**USMLE Triage 39**](../server/data/patient/Patient_USMLE_Triage_2.json)
  — Cas téléphonique, suspicion de maltraitance d'une mineure.

---

## 4. Catégorie 3 — `certificat_complaisance`

*v1.0.0 — inchangée Phase 7 J1.*

**Définition pédagogique** — Situations où le patient demande un
certificat médical (typiquement un arrêt de travail) pour des raisons
qui ne correspondent **pas** à une incapacité de travail médicalement
fondée. Le candidat doit identifier le **risque pénal et
disciplinaire** d'un certificat de complaisance, refuser **avec
explication du cadre légal**, et préserver la relation
thérapeutique en proposant des alternatives non frauduleuses.

### Bases légales suisses

| Code | Objet |
|---|---|
| **CP-318** | Faux dans les titres délivrés par certaines personnes. |
| **CDM art. 34 (FMH)** | Code de déontologie médicale FMH — sanction disciplinaire. |
| **CO art. 324a** | Paiement du salaire en cas d'empêchement (incapacité réelle). |

### Décision attendue : `decline_certificate`

* Refus **motivé** ; explication du cadre CP-318 / CDM.
* Validation empathique ; alternatives non frauduleuses (congés sans
  solde, médiation RH).
* Préservation de la relation thérapeutique.

### Anti-patterns

* **Émettre le certificat « pour cette fois »**.
* **Refuser sans expliquer** le cadre légal.
* **Moraliser ou juger** le patient.
* **Menacer de signaler** à l'employeur.
* **Rompre la relation** thérapeutique abruptement.

### Station annotée

* [**RESCOS-72**](../server/data/patient/Patient_RESCOS_4.json) —
  Demande d'arrêt de travail abusif.

---

## 5. Catégorie 4 — `violence_sexuelle_adulte`

*Nouvelle Phase 7 J1.*

**Définition pédagogique** — Prise en charge d'une victime adulte
d'agression sexuelle aux urgences ou en consultation. La consultation
combine trois dimensions : médicale (examen clinique, prophylaxie),
**médico-légale** (recueil de preuves sous 72h via le kit médico-légal
cantonal), et **psychosociale** (orientation centre LAVI, soutien
psychologique). La victime adulte capable de discernement est
**décisionnaire de la plainte** — le médecin ne signale jamais
automatiquement à la police pour un adulte capable, contrairement
aux mineurs (qui basculent dans `signalement_maltraitance`).

L'erreur pédagogique typique : transposer le cadre US (« mandated
reporter ») au cas CH adulte, OU inverser la culpabilité par des
questions intrusives (« pourquoi étiez-vous habillée ainsi »,
« êtes-vous sûre que c'était sans consentement »), OU imposer le
dépôt de plainte. La plainte est un **droit**, pas un devoir, pour
la victime adulte capable.

### Bases légales suisses

| Code | Objet |
|---|---|
| **LAVI art. 5** | Droit aux conseils, à l'information sur les ressources. |
| **LAVI art. 15** | Aide immédiate (soutien psychologique, médical, juridique en urgence). |
| **CP-189** | Contrainte sexuelle. |
| **CP-190** | Viol. |
| **CP-191** | Actes d'ordre sexuel sur mineur·e ou personne incapable de discernement. |
| **CDM art. 25** | Devoirs du médecin face à un patient victime. |

### Décision attendue : `refer`

* Reconnaître le contexte d'agression sexuelle ; nommer le concept
  d'absence de consentement / contrainte (sans imposer le mot).
* Proposer le **kit médico-légal sous 72h** (recueil de preuves) en
  expliquant que le résultat est conservé indépendamment de toute
  plainte ultérieure.
* Orienter vers un **centre LAVI** (consultation spécialisée gratuite,
  conseil juridique, accompagnement).
* Proposer un **soutien psychologique** spécialisé.
* Maintenir la **confidentialité absolue sauf demande de la
  patiente** ; rappeler que **la plainte reste son choix**.
* Adopter une posture d'**écoute sans jugement** (« je vous crois »,
  « vous êtes ici en sécurité », « personne ne vous force à parler »).

`mandatory_reporting = false` pour adulte capable de discernement.
Si la victime est mineure ou personne vulnérable, basculer dans
`signalement_maltraitance` (qui impose un signalement APEA).

### Anti-patterns (`candidate_must_avoid`)

* **Victim-blaming / questions inversant la culpabilité** —
  « pourquoi étiez-vous habillée comme ça », « êtes-vous sûre que
  c'était sans consentement », « pourquoi ne pas être partie plus
  tôt ». Ces formulations relèvent du *victim-blaming* et sont
  cliniquement nocives.
* **Imposer la plainte à la victime adulte capable** — « vous devez
  porter plainte » nie l'autonomie de la victime, qui est seule
  décisionnaire.
* **Signalement automatique à la police sans accord** — sauf si
  mineur ou personne vulnérable, l'adulte capable décide seul·e des
  démarches policières.

### Station prévue

* [**USMLE-9**](../server/data/patient/Patient_USMLE_1.json) —
  Agression sexuelle, femme de 25 ans. **Annotation prévue Phase 7
  J3** (status C reportée Phase 6).

---

## 6. Catégorie 5 — `capacite_discernement`

*Nouvelle Phase 7 J1.*

**Définition pédagogique** — Évaluation de la **capacité de
discernement** d'un patient pour un acte médical donné : consentement
éclairé à un traitement, refus de soin, sortie contre avis médical,
opposition à un traitement, choix de représentant. La capacité de
discernement est définie par **CC-16** selon une triade : **comprendre,
apprécier, décider**. Elle est **présumée** ; son absence doit être
**établie** au cas par cas, pour CET acte précis, et **documentée**.

L'erreur pédagogique typique : poser la question fermée « vous
comprenez ? » (qui ne teste pas la compréhension réelle), ou conclure
trop vite à l'incapacité globale alors qu'elle s'évalue par acte. À
l'inverse, **nier l'autonomie résiduelle** en confiant la décision
à la famille (« votre famille décide pour vous ») viole la directive
ASSM.

### Bases légales suisses

| Code | Objet |
|---|---|
| **CC-16** | Capacité de discernement — définition tripartite (comprendre, apprécier, décider). |
| **CC-394** | Curatelle de représentation (mandat précis). |
| **CC-443a** | Signalement à l'APEA pour adulte en danger / capacité de discernement insuffisante. |
| **CDM art. 3 al. 2** | Consentement éclairé du patient. |
| **ASSM directives** | Directives de l'Académie Suisse des Sciences Médicales sur la capacité de discernement. |

### Décision attendue : `refer`

* **Évaluation tripartite documentée** : tester la **compréhension**
  (« qu'avez-vous compris de ce que je vous ai dit ? »,
  « expliquez-moi avec vos mots »), l'**appréciation** (« quelles
  sont selon vous les conséquences ? »), la **décision**
  (cohérente avec les valeurs du patient).
* Si doute : **avis psychiatrique spécialisé**.
* Si incapacité établie : **saisine APEA** pour curatelle de
  représentation (CC-394 / CC-443a).
* **Documenter** rigoureusement la démarche au dossier.

### Anti-patterns

* **Question fermée « vous comprenez ? »** — ne teste pas la
  compréhension réelle ; remplacer par une question ouverte de
  reformulation.
* **Négation de l'autonomie résiduelle** — « votre famille décide
  pour vous », « ce n'est plus à vous de décider ». La famille peut
  être **associée** avec l'accord du patient, mais ne se substitue
  pas à lui tant qu'il garde une autonomie partielle.

`mandatory_reporting = false` par défaut. **Bascule** vers PLAFA
(art. 426 CC, placement à des fins d'assistance, hors scope J1) si
l'incapacité expose la personne à un danger imminent.

---

## 7. Catégorie 6 — `directives_anticipees`

*Nouvelle Phase 7 J1.*

**Définition pédagogique** — Recherche et **prise en compte** de
directives anticipées (DA) ou rédaction d'un mandat pour cause
d'inaptitude. Avant tout acte sur un patient en perte d'autonomie ou
à risque d'incapacité future, le médecin a un **devoir de recherche**
des directives existantes au dossier ; à défaut, il applique
l'**ordre légal de représentation** (CC-378). Si le patient est
encore capable de discernement et qu'il n'a pas rédigé de DA, le
médecin peut **ouvrir le dialogue** sur ses volontés futures sans
projeter ses propres valeurs.

L'erreur pédagogique typique : éviter le sujet par gêne (« ce n'est
pas le moment d'en parler »), ou projeter ses propres préférences
(« à votre place je ferais X »).

### Bases légales suisses

| Code | Objet |
|---|---|
| **CC-360 à CC-369** | Mandat pour cause d'inaptitude. |
| **CC-370 à CC-373** | Directives anticipées : forme écrite, datée, signée ; révocables à tout moment. |
| **CC-377 à CC-381** | Représentation pour décisions médicales en cas d'incapacité de discernement. CC-378 fixe l'ordre légal (conjoint, descendant·e·s, parents, etc.). |
| **CDM art. 4** | Relation médecin-patient. |

### Décision attendue : `refer`

* **Rechercher** les directives existantes au dossier (devoir actif).
* **Respecter** les volontés exprimées si DA valides.
* À défaut, appliquer l'**ordre légal de représentation CC-378**.
* **Orienter** vers un conseil juridique / notaire si le patient
  souhaite **rédiger** des directives (formulaire officiel FMH
  disponible).
* Communiquer le caractère **évolutif** des directives (modifiables
  à tout moment).

### Anti-patterns

* **Éviter le sujet par gêne** — « ce n'est pas le moment d'en
  parler », « passons à autre chose ». Le sujet doit être abordé
  proactivement chez les patients à risque.
* **Projeter ses propres valeurs** — « à votre place je ferais X »,
  « moi je choisirais Y ». Le médecin facilite le choix, ne le
  substitue pas.

`mandatory_reporting = false`.

---

## 8. Catégorie 7 — `responsabilite_teleconsult`

*Nouvelle Phase 7 J1.*

**Définition pédagogique** — Responsabilité médicale lors d'une
téléconsultation (téléphone ou visio). La téléconsultation engage la
**même responsabilité** qu'une consultation physique (devoir de
moyens, CO art. 394 + 398), mais avec des **limites d'examen**
explicites : le médecin doit reconnaître les limites, vérifier
l'identité du patient, recueillir le consentement à la
téléconsultation, **documenter rigoureusement** (date, heure, motif,
décisions, instructions), et **orienter en consultation physique**
en cas de doute. La téléconsultation manipule des **données
sensibles** (LPD art. 1+).

L'erreur pédagogique typique : prescrire à distance sans
documentation, donner un rendez-vous éloigné face à un red flag, ou
se rassurer (et rassurer le patient) sans examen.

### Bases légales suisses

| Code | Objet |
|---|---|
| **CDM art. 3 al. 3** | Devoirs du médecin lors de consultations à distance. |
| **CO art. 394** | Mandat — devoir de diligence. |
| **CO art. 398** | Devoir de moyens du mandataire (médecin). |
| **LPD art. 1+** | Loi sur la protection des données — données personnelles sensibles. |
| **FMH directives télémédecine** | Cadre déontologique FMH pour la télémédecine. |

### Décision attendue : `refer`

* Reconnaître **les limites de l'examen** à distance ; les **annoncer
  explicitement** au patient.
* **Vérifier l'identité** du patient (nom complet + date de
  naissance).
* Recueillir le **consentement** à la téléconsultation.
* Donner une **consigne de surveillance écrite** avec red flags
  identifiés.
* **Orienter aux urgences / consultation physique** dès le moindre
  doute clinique.
* **Documenter horodaté** au dossier (date, heure, motif, contenu,
  décisions, instructions remises).
* Communiquer le **caractère partiel** de l'évaluation.

### Anti-patterns

* **Prescription à distance sans documentation rigoureuse** — engage
  la responsabilité du médecin.
* **Rappel ultérieur insuffisant face à un red flag** — « je vous
  rappelle dans une semaine » alors qu'une orientation urgente
  s'impose.
* **Rassurance creuse sans examen** — « tout va bien, ne vous
  inquiétez pas » sans avoir pu examiner physiquement.

`mandatory_reporting = false`.

---

## 9. Tableau récapitulatif des 7 catégories

| Catégorie | Décision attendue | `mandatory_reporting` | Bases CH dominantes | Phase |
|---|---|---|---|---|
| `secret_pro_levee` | `refer` | `false` | CP-321, CP-364, LAVI | 5 |
| `signalement_maltraitance` | `report` | `true` | CP-321, CP-364bis, CC-314c, CC-443a, LAVI | 5 |
| `certificat_complaisance` | `decline_certificate` | `false` | CP-318, CDM art. 34, CO art. 324a | 5 |
| `violence_sexuelle_adulte` | `refer` | `false` | LAVI art. 5+15, CP-189, CP-190, CP-191, CDM art. 25 | 7 J1 |
| `capacite_discernement` | `refer` | `false` | CC-16, CC-394, CC-443a, CDM art. 3, ASSM directives | 7 J1 |
| `directives_anticipees` | `refer` | `false` | CC-360 à CC-373, CC-377 à CC-381, CDM art. 4 | 7 J1 |
| `responsabilite_teleconsult` | `refer` | `false` | CDM art. 3 al. 3, CO art. 394+398, LPD, FMH directives télémédecine | 7 J1 |

---

## 10. Tableau récapitulatif des stations annotées

| ID | Catégorie | Décision | Lois invoquées | Subject status | Phase |
|---|---|---|---|---|---|
| AMBOSS-24 | `secret_pro_levee` | `refer` | CP-321, CP-364, LAVI-art-1 | adult_capable | 5 J1 |
| USMLE-34 | `signalement_maltraitance` | `report` | CP-321, CP-364, CP-364bis, CC-307, CC-314c | adult_capable | 5 J1 |
| RESCOS-72 | `certificat_complaisance` | `decline_certificate` | CP-318, CDM-FMH-art-34, CO-art-324a | adult_capable | 5 J1 |
| USMLE Triage 39 | `signalement_maltraitance` | `report` | CP-321, CP-364, CP-364bis, CC-307, CC-314c | minor | 6 J2 |
| USMLE-9 *(prévue)* | `violence_sexuelle_adulte` | `refer` | LAVI-art-5, LAVI-art-15, CP-189, CP-190 | adult_capable | **7 J3** |

J1 livre uniquement le lexique étendu : **aucune nouvelle station n'est
annotée en J1**. USMLE-9 sera annotée en J3 dans la nouvelle catégorie
`violence_sexuelle_adulte`.

---

## 11. Glossaire des termes CH étendu

| Terme | Définition |
|---|---|
| **APEA** | Autorité de protection de l'enfant et de l'adulte. Reçoit les signalements CC-314c (mineurs) et CC-443a (adultes vulnérables). |
| **ASSM** | Académie Suisse des Sciences Médicales. Édite des directives éthiques médicales (capacité de discernement, fin de vie, recherche, etc.). |
| **CC** | Code civil suisse — droit de la famille, protection de la personnalité, mesures de protection. |
| **CC-16** | Capacité de discernement (définition tripartite : comprendre, apprécier, décider). Présumée, son absence doit être établie. |
| **CC-307** | Mesures de protection de l'enfant (curatelle, retrait de garde, placement). |
| **CC-314c** | Signalement à l'APEA pour la protection d'un mineur. |
| **CC-360 à CC-369** | Mandat pour cause d'inaptitude — désigner à l'avance la personne qui prendra les décisions en cas d'inaptitude. |
| **CC-370 à CC-373** | Directives anticipées : forme écrite, datée, signée ; révocables. |
| **CC-377 à CC-381** | Représentation pour décisions médicales en cas d'incapacité ; CC-378 fixe l'ordre légal. |
| **CC-394** | Curatelle de représentation. |
| **CC-443a** | Signalement à l'APEA pour adulte vulnérable. |
| **CDM** | Code de déontologie médicale (FMH). |
| **CDM art. 3** | Consentement éclairé. |
| **CDM art. 34** | Interdit la délivrance de certificats inexacts ou de complaisance. |
| **CO** | Code des obligations — droit du contrat de travail (art. 324a) et du mandat (art. 394, 398). |
| **CO art. 324a** | Paiement du salaire en cas d'empêchement non fautif. |
| **CO art. 394 / 398** | Mandat — devoir de diligence et de moyens. Cadre de la responsabilité médicale en téléconsultation. |
| **CP** | Code pénal suisse. |
| **CP-189** | Contrainte sexuelle. |
| **CP-190** | Viol. |
| **CP-191** | Actes d'ordre sexuel sur mineur·e ou incapable de discernement. |
| **CP-318** | Faux dans les titres — incrimine notamment le certificat médical de complaisance. |
| **CP-321** | Violation du secret professionnel. |
| **CP-364** | Droit d'aviser pour les professionnels (cas adulte). |
| **CP-364bis** | Devoir d'aviser pour les professionnels en contact avec des mineurs (en vigueur depuis 2019). |
| **FMH** | Foederatio Medicorum Helveticorum — Fédération des médecins suisses. Édite le CDM. |
| **Kit médico-légal cantonal** | Procédure standardisée de recueil de preuves chez la victime de violence sexuelle, à pratiquer **sous 72h** idéalement. Le résultat est conservé indépendamment de toute plainte ; la victime peut décider plus tard de l'utiliser. |
| **LAVI** | Loi fédérale sur l'aide aux victimes d'infractions. Soutien gratuit (centres LAVI cantonaux), indépendant du dépôt de plainte. |
| **LAVI art. 5** | Droit aux conseils. |
| **LAVI art. 15** | Aide immédiate (médicale, psychologique, juridique). |
| **LPD** | Loi fédérale sur la protection des données (révisée 2023). Cadre des données personnelles sensibles, dont les données de santé manipulées en téléconsultation. |
| **Mandat pour cause d'inaptitude** | Désignation à l'avance, par une personne capable de discernement, de qui décidera pour elle en cas de perte de capacité (CC-360+). |
| **PLAFA** | Placement à des fins d'assistance (art. 426 CC) — placement non volontaire pour incapacité aiguë. Hors scope v1.1.0 ; candidat Phase 8. |
| **Représentation thérapeutique** | Personne désignée pour décider à la place du patient incapable de discernement (CC-377 / CC-378). À défaut de directive, ordre légal CC-378 (conjoint, descendant·e·s, parents, frères et sœurs). |
| **Téléconsultation** | Consultation à distance (téléphone, visio). Engage la même responsabilité qu'une consultation physique mais avec limites d'examen explicites. Documentation horodatée et orientation physique en cas de doute sont impératives. |
| **Vérification d'identité** | Étape obligatoire en début de téléconsultation : nom complet, date de naissance, voire confirmation visuelle si visio. |
| **Constat médical descriptif (à fin de preuve)** | Document factuel (ecchymoses, lésions, datation présumée, photos) délivré au patient ou conservé au dossier. À distinguer du certificat médical d'incapacité de travail. |
| **Mandated reporter** | Concept anglo-saxon (US) du « professionnel obligé de signaler ». En droit CH, n'a pas d'équivalent général ; CP-364bis crée un devoir analogue limité aux mineurs. **Ne pas transposer mécaniquement** le cadre US. |
| **Foyer / maison d'accueil** | Hébergement d'urgence pour personnes victimes de violence. Réseau cantonal soutenu par la LAVI. |

---

## 12. Sources et références publiques

* **admin.ch** — recueil systématique du droit fédéral (CC, CP, CO, LAVI, LPD).
* **fmh.ch** — Code de déontologie médicale FMH, fiches éthiques,
  directives télémédecine.
* **kokes.ch** — Conférence suisse des autorités de protection de
  l'enfant et de l'adulte (KOKES) — guides APEA cantonaux.
* **lavi-info.ch** — portail public d'information sur la LAVI et liste
  des centres cantonaux.
* **samw.ch** — Académie Suisse des Sciences Médicales (ASSM) —
  directives sur la capacité de discernement, les directives
  anticipées, la fin de vie, la télémédecine.

Pour toute station du corpus impliquant une dimension médico-légale,
le rédacteur (humain) peut compléter le `decision_rationale` en citant
ces sources publiques. Le LLM patient n'a en revanche **jamais** accès
au `decision_rationale` (cf.
[`META_FIELDS_TO_STRIP`](../server/services/patientService.ts)), ce
qui élimine le risque que la patiente cite spontanément la « bonne »
base légale et fausse l'évaluation.

---

*Document mis à jour en clôture Phase 7 J1 — version v1.1.0 du
lexique. Versions ultérieures prévues si extensions catégorielles
en Phase 8+ (cf.* [`docs/phase-6-bilan.md` § 8](./phase-6-bilan.md#8-dette-technique-reportée-phase-7) *).*
