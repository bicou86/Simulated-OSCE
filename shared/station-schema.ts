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

// Schéma de station permissif :
//   • `id` requis (déjà invariant fort dans stationsService),
//   • `participants` optionnel,
//   • `.passthrough()` laisse intacts tous les champs historiques
//     (nom, age, patient_description, vitals, antecedents, …) sans les
//     décrire — l'objectif J1 est seulement de typer le champ additif.
export const stationSchema = z
  .object({
    id: z.string().min(1),
    participants: z.array(participantSchema).optional(),
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
