// Phase 4 J1 — schéma Zod additif pour décrire plusieurs interlocuteurs sur
// une même station ECOS (ex. ado + mère, patient + accompagnant·e).
//
// Invariants :
//   • Additif uniquement : aucun champ existant (id, nom, age, patient_description,
//     vitals, …) n'est renommé. Les 284 stations historiques continuent de parser
//     sans annotation (cf. stationSchema.passthrough).
//   • Rétrocompat 100 % mono-patient : si `participants` est absent, l'helper
//     getStationParticipants() synthétise un participant unique « patient » à
//     partir des champs legacy (nom / age / patient_description).
//   • Pas de LLM dans la validation : le parsing reste 100 % déterministe Zod.
//   • Le schéma est *déclaratif* en J1 (typage + tests). Aucun consommateur
//     runtime n'est branché dessus à ce stade — ce sera J2 (router d'adresse)
//     puis J3 (cloisonnement runtime).

import { z } from "zod";

// Rôle du participant dans la station :
//   • patient      : le sujet médical de la consultation.
//   • accompanying : tiers présent qui peut s'adresser au candidat (parent
//                    d'un enfant, conjoint·e d'une personne âgée, …).
//   • witness      : tiers présent mais non-locuteur principal (témoin
//                    d'un accident, autre soignant relais). Réservé pour
//                    extension ultérieure ; toléré par le schéma dès J1.
export const participantRoleSchema = z.enum(["patient", "accompanying", "witness"]);
export type ParticipantRole = z.infer<typeof participantRoleSchema>;

// Phase 10 J3 — dette 6 : alignement speakerRole côté flow examinateur.
//
// `ConversationSpeakerRole` est un type DISTINCT de `ParticipantRole`
// (additif strict, Q-D6 option B validée user). Il étend l'enum de 3 à 4
// valeurs en ajoutant "examiner" pour refléter exactement le speaker
// renvoyé par les flows /api/patient/chat et /api/patient/chat/stream
// quand `conversationMode === "examiner"` (stations doubles partie 2).
//
// Pourquoi un type distinct au lieu d'étendre ParticipantRole :
//   • ParticipantRole décrit la composition statique d'une station OSCE
//     (qui sont les profils présents — patient, accompagnant, témoin).
//     Un examinateur n'est PAS un profil de la station ; c'est un rôle
//     conversationnel runtime, propre au flow Phase 9 J1.
//   • Étendre ParticipantRole risquerait de casser tout consommateur
//     qui exhausting-switch sur les 3 valeurs (UI multi-profils, tests
//     d'audit corpus, …). Le contrat `participantRoleSchema` reste
//     strictement à 3 valeurs (invariant Phase 4 J1 préservé).
//   • Avant J3, les flows examinateur retournaient `speakerRole: "patient"`
//     (placeholder type-compat, cf. commentaire patientService.ts:881-883).
//     C'est cette incohérence sémantique qui est résolue par J3.
//
// La compatibilité côté frontend est assurée par fallback : un client
// pré-J3 qui voyait `speakerRole === "patient"` + `speakerId === "examiner"`
// affichait déjà "Examinateur" via heuristique sur speakerId. Post-J3,
// le client peut désormais utiliser `speakerRole === "examiner"`
// directement, en conservant le fallback speakerId pour robustesse.
export const conversationSpeakerRoleSchema = z.enum([
  "patient", "accompanying", "witness", "examiner",
]);
export type ConversationSpeakerRole = z.infer<typeof conversationSpeakerRoleSchema>;

// Registre lexical attendu : `medical` = soignant·e formé·e, `lay` = profane.
// Sert au prompt routing et aux blacklists de jargon (cf. caregiver.md vs
// patient.md). Tous les pilotes J1 sont en `lay`.
export const participantVocabularySchema = z.enum(["medical", "lay"]);
export type ParticipantVocabulary = z.infer<typeof participantVocabularySchema>;

// Convention pour `knowledgeScope` :
//   tags texte libre, format `<sujet>.<facette>` (ex. `self.symptoms`,
//   `family.history`, `child.development`). Servira en J3 à filtrer les
//   informations consultables par profil. En J1, simple champ déclaratif —
//   le schéma exige un tableau de strings non vides mais ne contraint pas
//   le vocabulaire.
const knowledgeTagSchema = z.string().min(1);

export const participantSchema = z.object({
  id: z.string().min(1),
  role: participantRoleSchema,
  name: z.string().min(1),
  age: z.number().int().nonnegative().optional(),
  vocabulary: participantVocabularySchema,
  knowledgeScope: z.array(knowledgeTagSchema),
});
export type Participant = z.infer<typeof participantSchema>;

// Phase 4 J3 — `participantSections` : règles de cloisonnement par section.
//   • Clé = chemin pointé dans le JSON de la station, ex.
//     `histoire_actuelle.symptomesAssocies`, `antecedents.gyneco`, ou
//     un top-level seul (`contexte`, `motif_cache`).
//   • Valeur = liste de tags (≥ 1). Un participant voit la section si SON
//     `knowledgeScope` intersecte la liste de tags.
//   • Une section ABSENTE de cette table est visible par défaut à tous
//     les participants (rétrocompat 100 % stations mono-patient et
//     toutes les sections legacy non-sensibles).
//   • Validation au boot (`validateMultiProfileStations` dans
//     stationsService) : tout chemin référencé doit exister dans le JSON
//     de la station, tout tag listé doit appartenir à au moins un
//     participant — sinon, throw immédiat.
export const participantSectionsSchema = z.record(
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
);
export type ParticipantSections = z.infer<typeof participantSectionsSchema>;

// Phase 5 J1 — `legalContext` : qualification médico-légale d'une station.
//
// Champ STATION-LEVEL, additif et OPTIONNEL. Décrit le cadre juridique
// suisse applicable, la décision attendue, les faits objectifs qui la
// justifient, et les concepts que le candidat doit verbaliser ou éviter.
// Consommé par l'évaluateur médico-légal (J2) qui en dérive un score
// gradé 0/1/2 par item agrégé en pourcentage par axe.
//
// INVARIANTS
//   • Le champ `decision_rationale` (et plus généralement TOUT
//     `legalContext`) est strippé par `META_FIELDS_TO_STRIP` dans
//     `filterStationByScope` — JAMAIS injecté au LLM patient
//     (cf. invariant Phase 5 A : le patient ne cite jamais le bon
//     cadre légal lui-même).
//   • Schéma additif strict : aucun champ n'est rebaptisé. Les 286
//     stations historiques continuent de parser sans annotation.
//   • Pas de LLM dans la validation : Zod déterministe.
//   • Le scoring (gradé 0/1/2) est isolé dans /api/evaluation/legal —
//     ne touche pas les 5 axes Phase 2/3 (anamnese, examen, management,
//     cloture, communication).
// Phase 7 J1 — extension v1.0.0 → v1.1.0 : ajout de 4 catégories
// pédagogiques (violence_sexuelle_adulte, capacite_discernement,
// directives_anticipees, responsabilite_teleconsult). Additif strict :
// AUCUNE valeur supprimée — les 5 valeurs Phase 5 (3 actives + 2
// réservées : `signalement_danger_tiers`, `declaration_obligatoire`)
// sont maintenues. Total : 9 valeurs acceptées, dont 7 disposent d'une
// couverture lexique (cf. `listLegalLexiconCategories` dans
// `server/lib/legalLexicon.ts`).
export const legalCategorySchema = z.enum([
  "signalement_maltraitance",
  "signalement_danger_tiers",
  "secret_pro_levee",
  "certificat_complaisance",
  "declaration_obligatoire",
  "violence_sexuelle_adulte",
  "capacite_discernement",
  "directives_anticipees",
  "responsabilite_teleconsult",
]);
export type LegalCategory = z.infer<typeof legalCategorySchema>;

// `subject_status` pilote l'arsenal légal applicable :
//   • minor          ⇒ CP 364bis / CC 307–315 (protection de l'enfant)
//   • adult_capable  ⇒ CP 321 / CDM FMH (cadre standard)
//   • adult_incapable ⇒ CC 443a (signalement à l'APEA, capacité de
//                                discernement insuffisante)
export const legalSubjectStatusSchema = z.enum([
  "minor",
  "adult_capable",
  "adult_incapable",
]);
export type LegalSubjectStatus = z.infer<typeof legalSubjectStatusSchema>;

// Décision attendue — pilote le scoring axe « décision » dans l'évaluateur :
//   • report             ⇒ signaler à l'autorité (APEA / police / OFSP)
//   • no_report          ⇒ ne PAS signaler (faits insuffisants /
//                          confidentialité prime)
//   • defer              ⇒ différer (recueil d'éléments, deuxième consult)
//   • refer              ⇒ orienter (foyer, gynéco-obstétrique, juriste FMH)
//   • decline_certificate ⇒ refuser le certificat
export const legalExpectedDecisionSchema = z.enum([
  "report",
  "no_report",
  "defer",
  "refer",
  "decline_certificate",
]);
export type LegalExpectedDecision = z.infer<typeof legalExpectedDecisionSchema>;

// Juridiction — par défaut « CH » (droit fédéral suisse). Évolutivité
// cantonale réservée pour Phase 6 ; les 3 pilotes Phase 5 J1 sont
// fédéral-only (`applicable_law` reste cantonal-agnostic).
export const legalJurisdictionSchema = z.enum([
  "CH",
  "VD",
  "GE",
  "BE",
  "FR",
  "ZH",
]);
export type LegalJurisdiction = z.infer<typeof legalJurisdictionSchema>;

export const legalContextSchema = z.object({
  category: legalCategorySchema,
  jurisdiction: legalJurisdictionSchema.optional(),
  subject_status: legalSubjectStatusSchema,
  applicable_law: z.array(z.string().min(1)).min(1),
  mandatory_reporting: z.boolean(),
  expected_decision: legalExpectedDecisionSchema,
  decision_rationale: z.string().min(1),
  red_flags: z.array(z.string().min(1)).min(1),
  candidate_must_verbalize: z.array(z.string().min(1)).min(1),
  candidate_must_avoid: z.array(z.string().min(1)),
});
export type LegalContext = z.infer<typeof legalContextSchema>;

// Phase 6 J1 — `medicoLegalReviewed` : tracker du triage Phase 6.
//
// Champ STATION-LEVEL, ADDITIF, OPTIONNEL, default false. Indique si la
// station a été passée en revue par le triage médico-légal Phase 6
// (relecture humaine d'un médecin CH). N'a AUCUN impact runtime :
//   • non lu par /api/patient/:id/brief (pas exposé au client),
//   • non lu par buildSystemPrompt (pas injecté au LLM),
//   • non lu par /api/evaluator/evaluate (Phase 2/3),
//   • non lu par /api/evaluation/legal (Phase 5 J2).
// Le flag est uniquement consommé par le script de triage (J1) et
// éventuellement par un futur rapport d'avancement Phase 6 J3.
//
// En J1, AUCUNE station ne porte ce flag : le script écrit du CSV, pas
// dans les fichiers JSON. En J2, le flag sera mis à `true` au moment où
// le legalContext est ajouté à une station (ou pour confirmer qu'elle a
// été vue et marquée non applicable).

// Phase 8 J1 — `parentStationId` : référence vers une station parente
// pour les « stations doubles » (partie 1 anamnèse/examen + partie 2
// présentation orale au spécialiste).
//
// Cas d'usage canonique : RESCOS-64 (toux chronique avec hémoptysie).
// Partie 1 = consultation patient simulé (13 min, scoring 6-axes Phase 7).
// Partie 2 = présentation orale du cas au pneumologue (4 min prép + 9 min
// présentation, scoring 4 axes 25% chacun ISOLÉ du scoring 6-axes —
// jamais agrégé, cf. arbitrage utilisateur Phase 8 #4). La partie 2
// portera `parentStationId` pointant vers le shortId de la partie 1.
//
// INVARIANTS
//   • Strictement OPTIONNEL : à Phase 8 J1, aucune station ne porte
//     ce champ. À Phase 8 J2, RESCOS-64-P2 (partie 2 station double)
//     devient la première et unique station qui le porte (1/288).
//     Les 287 autres stations parsent sans modification.
//   • Type minimal : `z.string().min(1)` (shortId non-vide). La
//     validation RÉFÉRENTIELLE (le shortId pointé existe dans le
//     catalogue) est confiée à `validateParentStationIds` côté
//     `stationsService` — Zod local n'a pas accès au catalogue, et
//     l'init catalogue précède la validation référentielle (cycle
//     d'init two-pass : ingestion globale → validation post-init).
//   • Aucune création de fixture partie 2 en J1 : J1 = schéma + tests
//     uniquement. Les fixtures partie 2 arriveront en J2.

// Phase 9 J2 — schéma `phases` additif pour les stations doubles partie 2
// (Bug 3a E2E Phase 8). Décrit le découpage temporel chronométré d'une
// station entre une phase de préparation silencieuse et une phase
// interactive (présentation au LLM examinateur, ou autres flows futurs).
//
// CONVENTION RESCOS-64-P2 (validée arbitrage utilisateur Phase 9 cadrage B) :
//   • phase 1 « preparation » : 4 min silencieuses (zéro appel LLM)
//   • phase 2 « presentation » : 9 min interactives avec examinateur
//   • Total chronométré = 13 min
//
// INVARIANTS
//   • Strictement OPTIONNEL : à Phase 9 J2, seule RESCOS-64-P2 porte ce
//     champ. Les 287 autres stations parsent sans modification (timer
//     UI legacy 13 min unique préservé via fallback).
//   • `kind: "silent"` → la phase n'émet aucun événement LLM ; sert
//     uniquement de chronomètre de préparation visible côté candidat.
//   • `kind: "examiner"` → la phase déclenche l'ouverture du flow
//     examinateur (cf. Phase 9 J1 conversationMode="examiner").
//   • Les minutes sont en nombres entiers strictement positifs (pas de
//     phases vides).
//   • La somme des minutes définit la durée totale chronométrée. Aucune
//     contrainte forte (le code consommateur peut comparer somme et
//     duration globale si elle est ajoutée par ailleurs).
export const phaseKindSchema = z.enum(["silent", "examiner"]);
export type PhaseKind = z.infer<typeof phaseKindSchema>;

export const stationPhaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  minutes: z.number().int().positive(),
  kind: phaseKindSchema,
});
export type StationPhase = z.infer<typeof stationPhaseSchema>;

// Schéma de station permissif :
//   • `id` requis (déjà invariant fort dans stationsService),
//   • `participants` optionnel (Phase 4 J1),
//   • `participantSections` optionnel (Phase 4 J3),
//   • `legalContext` optionnel (Phase 5 J1),
//   • `medicoLegalReviewed` optionnel default false (Phase 6 J1),
//   • `parentStationId` optionnel (Phase 8 J1, validation référentielle
//     post-init dans stationsService),
//   • `phases` optionnel (Phase 9 J2, découpage temporel des stations
//     doubles partie 2 — fallback durée unique 13 min si absent),
//   • `consigneCandidat` optionnel (Phase 9 J2, consigne candidat
//     orientée présentation pour partie 2 — fallback patient_description
//     si absent),
//   • `.passthrough()` laisse intacts tous les champs historiques
//     (nom, age, patient_description, vitals, antecedents, …) sans les
//     décrire — l'objectif est seulement de typer les champs additifs.
export const stationSchema = z
  .object({
    id: z.string().min(1),
    participants: z.array(participantSchema).optional(),
    participantSections: participantSectionsSchema.optional(),
    legalContext: legalContextSchema.optional(),
    medicoLegalReviewed: z.boolean().optional().default(false),
    parentStationId: z.string().min(1).optional(),
    phases: z.array(stationPhaseSchema).min(1).optional(),
    consigneCandidat: z.string().min(1).optional(),
  })
  .passthrough();
export type Station = z.infer<typeof stationSchema>;

// Helper rétrocompat : retourne la liste de profils d'une station.
//
//   • Si la station déclare `participants[]` (≥ 1 entrée), on la renvoie
//     telle quelle après validation Zod.
//   • Sinon, on synthétise un participant unique « patient » à partir des
//     champs legacy. Le `knowledgeScope` synthétique est volontairement
//     minimal (`self.history`, `self.symptoms`) — il sera enrichi par J3
//     quand le routeur de cloisonnement aura besoin de tags discriminants.
//
// Tout consommateur multi-profils (UI dual-speaker J4, router J2, etc.)
// peut donc itérer sur `getStationParticipants(station)` sans brancher sur
// la présence du champ `participants`.
export function getStationParticipants(rawStation: unknown): Participant[] {
  const station = stationSchema.parse(rawStation);
  if (station.participants && station.participants.length > 0) {
    return station.participants;
  }
  const legacy = station as Record<string, unknown>;
  const name =
    typeof legacy.nom === "string" && legacy.nom.length > 0
      ? legacy.nom
      : "patient";
  const ageRaw = legacy.patient_age_years ?? legacy.age;
  const age =
    typeof ageRaw === "number" && Number.isFinite(ageRaw) && ageRaw >= 0
      ? Math.trunc(ageRaw)
      : undefined;
  return [
    {
      id: "patient",
      role: "patient",
      name,
      age,
      vocabulary: "lay",
      knowledgeScope: ["self.history", "self.symptoms"],
    },
  ];
}

// Indique si la station est annotée multi-profils (≥ 2 participants déclarés).
// Sucre syntaxique pour les tests et l'UI.
export function isMultiProfileStation(rawStation: unknown): boolean {
  const station = stationSchema.parse(rawStation);
  return Array.isArray(station.participants) && station.participants.length >= 2;
}
