// Phase 11 J2 — service de lecture du bloc pédagogique d'une station.
//
// Endpoint cible : GET /api/patient/:stationId/pedagogy (cf. routes/patient.ts).
// Aucune logique heuristique, ZÉRO appel LLM, ZÉRO mutation : on relit la
// station depuis le catalogue déjà chargé en mémoire (réutilise le cache
// de patientService.getPatientStation), on valide le sous-bloc Zod, et on
// retourne tel quel.
//
// INVARIANTS
//   • I13 — Le contenu pédagogique n'est JAMAIS injecté dans le prompt
//     LLM patient (cf. META_FIELDS_TO_STRIP, patientService.ts).
//   • I14 — Le contenu pédagogique n'est JAMAIS remonté par /brief
//     (qui sert le candidat pendant la station). Cet endpoint est
//     l'unique point d'entrée de lecture.
//
// La validation Zod est défensive : si une fixture future portait un
// `pedagogicalContent` malformé qui aurait échappé au boot (la
// validation `stationSchema.parse` est passthrough sur les passes
// d'audit corpus existantes), on throw — le routeur convertit en 500.

import { pedagogicalContentSchema, type PedagogicalContent } from "@shared/pedagogical-content-schema";
import { getPatientStation, StationNotFoundError } from "./patientService";

export interface PatientPedagogy {
  stationId: string;
  pedagogicalContent: PedagogicalContent | null;
}

export async function getPatientPedagogy(stationId: string): Promise<PatientPedagogy> {
  // Délègue la résolution / la fenêtre d'erreur StationNotFoundError au
  // service patient (catalogue partagé, fileCache identique) : on évite
  // toute duplication d'I/O ou d'index.
  const station = await getPatientStation(stationId);
  const raw = (station as { pedagogicalContent?: unknown }).pedagogicalContent;
  if (raw === undefined || raw === null) {
    return { stationId, pedagogicalContent: null };
  }
  // Throw via Zod si malformé — le routeur HTTP traduira en 500 explicite.
  const parsed = pedagogicalContentSchema.parse(raw);
  return { stationId, pedagogicalContent: parsed };
}

export { StationNotFoundError };
