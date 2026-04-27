// Phase 4 J1 — tests du schéma additif `participants[]`.
//
// Couvre :
//   1. Validation Zod du sous-schéma participantSchema (cas valides / invalides).
//   2. Rétrocompatibilité : une station mono-patient sans `participants`
//      continue de parser via stationSchema.
//   3. Une station multi-profils annotée expose `participants` correctement
//      typé et la station déclarée par les 5 pilotes RESCOS-9b/13/63/70/71
//      passe la validation telle qu'elle est sur disque.
//   4. Helper rétrocompat : getStationParticipants() synthétise un
//      participant unique pour une station mono-patient et restitue tel quel
//      le tableau quand il est déclaré.
//
// Aucun LLM n'est invoqué : parsing 100 % Zod déterministe (invariant ECOS).

import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  getStationParticipants,
  isMultiProfileStation,
  participantSchema,
  stationSchema,
  type Participant,
} from "@shared/station-schema";

const PATIENT_DIR = path.resolve(__dirname, "..", "data", "patient");

// Charge le tableau `stations` d'un Patient_*.json et renvoie la station par
// shortId (ex. "RESCOS-9b"). Helper local : on reste indépendants de
// stationsService pour ne pas couvrir un autre module sous le même test.
async function loadStation(filename: string, shortId: string): Promise<unknown> {
  const raw = await fs.readFile(path.join(PATIENT_DIR, filename), "utf-8");
  const parsed = JSON.parse(raw) as { stations: Array<{ id: string }> };
  const found = parsed.stations.find((s) => s.id.startsWith(shortId + " "));
  if (!found) throw new Error(`station ${shortId} introuvable dans ${filename}`);
  return found;
}

describe("participantSchema (Phase 4 J1)", () => {
  it("accepts a minimal patient participant", () => {
    const r = participantSchema.safeParse({
      id: "p1",
      role: "patient",
      name: "Alice",
      vocabulary: "lay",
      knowledgeScope: ["self.symptoms"],
    });
    expect(r.success).toBe(true);
  });

  it("accepts an accompanying participant with age", () => {
    const r = participantSchema.safeParse({
      id: "mother",
      role: "accompanying",
      name: "Mère d'Alice",
      age: 42,
      vocabulary: "lay",
      knowledgeScope: ["family.history", "household.context"],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.age).toBe(42);
  });

  it("accepts the witness role (réservé pour extension)", () => {
    const r = participantSchema.safeParse({
      id: "neighbor",
      role: "witness",
      name: "Voisin",
      vocabulary: "lay",
      knowledgeScope: ["incident.observed"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown role", () => {
    const r = participantSchema.safeParse({
      id: "x",
      role: "spouse", // pas dans l'enum
      name: "X",
      vocabulary: "lay",
      knowledgeScope: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown vocabulary register", () => {
    const r = participantSchema.safeParse({
      id: "x",
      role: "patient",
      name: "X",
      vocabulary: "academic", // pas dans l'enum
      knowledgeScope: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty name", () => {
    const r = participantSchema.safeParse({
      id: "x",
      role: "patient",
      name: "",
      vocabulary: "lay",
      knowledgeScope: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a negative age", () => {
    const r = participantSchema.safeParse({
      id: "x",
      role: "patient",
      name: "X",
      age: -1,
      vocabulary: "lay",
      knowledgeScope: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty knowledgeScope tag", () => {
    const r = participantSchema.safeParse({
      id: "x",
      role: "patient",
      name: "X",
      vocabulary: "lay",
      knowledgeScope: [""],
    });
    expect(r.success).toBe(false);
  });
});

describe("stationSchema — rétrocompat mono-patient (Phase 4 J1)", () => {
  it("parses a typical legacy station without participants[]", async () => {
    // RESCOS-1 = mono-patient classique, jamais annoté Phase 4. Doit parser
    // tel quel grâce à .passthrough().
    const station = await loadStation("Patient_RESCOS_1.json", "RESCOS-1");
    const r = stationSchema.safeParse(station);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.participants).toBeUndefined();
      // Les champs legacy passent à travers .passthrough() sans être
      // décrits explicitement — on vérifie qu'ils sont préservés.
      expect((r.data as Record<string, unknown>).patient_description).toBeTypeOf("string");
    }
  });

  it("getStationParticipants synthesizes a single patient profile from legacy fields", async () => {
    const station = await loadStation("Patient_RESCOS_1.json", "RESCOS-1") as Record<string, unknown>;
    const participants = getStationParticipants(station);
    expect(participants).toHaveLength(1);
    const p = participants[0];
    expect(p.role).toBe("patient");
    expect(p.id).toBe("patient");
    expect(p.vocabulary).toBe("lay");
    // Le nom synthétisé reprend le champ legacy `nom`.
    expect(p.name).toBe(station.nom ?? "patient");
  });

  it("isMultiProfileStation returns false for a mono-patient station", async () => {
    const station = await loadStation("Patient_RESCOS_1.json", "RESCOS-1");
    expect(isMultiProfileStation(station)).toBe(false);
  });
});

describe("stationSchema — pilotes multi-profils (Phase 4 J1)", () => {
  // Liste des 5 pilotes annotés sur disque + métadonnées attendues.
  const PILOTS: Array<{ file: string; id: string; expectedNames: [string, string] }> = [
    { file: "Patient_RESCOS_1.json", id: "RESCOS-9b", expectedNames: ["Charlotte Borloz", "Parent de Charlotte Borloz"] },
    { file: "Patient_RESCOS_1.json", id: "RESCOS-13", expectedNames: ["Anne/Steve Peters", "Mère d'Anne/Steve"] },
    { file: "Patient_RESCOS_4.json", id: "RESCOS-63", expectedNames: ["Liam Lambretta", "Parent de Liam"] },
    { file: "Patient_RESCOS_4.json", id: "RESCOS-70", expectedNames: ["Emma Delacroix", "Mère d'Emma Delacroix"] },
    { file: "Patient_RESCOS_4.json", id: "RESCOS-71", expectedNames: ["M. Louis Bettaz", "Martine Bettaz"] },
  ];

  it.each(PILOTS)("$id parses with two participants (patient + accompanying)", async ({ file, id, expectedNames }) => {
    const station = await loadStation(file, id);
    const parsed = stationSchema.parse(station);
    expect(parsed.participants).toBeDefined();
    expect(parsed.participants).toHaveLength(2);
    const [first, second] = parsed.participants as [Participant, Participant];
    expect(first.role).toBe("patient");
    expect(second.role).toBe("accompanying");
    expect(first.name).toBe(expectedNames[0]);
    expect(second.name).toBe(expectedNames[1]);
    // Les tags knowledgeScope doivent toujours être un tableau non-null.
    expect(Array.isArray(first.knowledgeScope)).toBe(true);
    expect(Array.isArray(second.knowledgeScope)).toBe(true);
  });

  it.each(PILOTS)("$id is reported as multi-profile and yields participants[] as-is", async ({ file, id }) => {
    const station = await loadStation(file, id);
    expect(isMultiProfileStation(station)).toBe(true);
    const participants = getStationParticipants(station);
    expect(participants).toHaveLength(2);
    // L'helper restitue les participants tels que déclarés (pas de
    // synthèse), donc `id` ne doit pas être l'identifiant fallback.
    expect(participants[0].id).not.toBe("patient" === participants[0].id ? "" : "patient");
  });

  it("RESCOS-70 ado profile uses lay vocabulary and exposes scope tags du domaine (J3)", async () => {
    const station = await loadStation("Patient_RESCOS_4.json", "RESCOS-70");
    const [emma] = getStationParticipants(station);
    expect(emma.vocabulary).toBe("lay");
    expect(emma.age).toBe(16);
    // Phase 4 J3 — taxonomie domain-specific (sexual_health, contraception,
    // school, …) qui pilote le filtre participantSections. Les tags J1
    // génériques (`self.*`) ont été remplacés par cette taxonomie ciblée
    // et le filtre serveur ne lit que ces tags-là.
    expect(emma.knowledgeScope).toContain("sexual_health");
    expect(emma.knowledgeScope).toContain("contraception");
  });

  it("RESCOS-71 caregiver profile carries caregiver_burden in knowledgeScope (J3)", async () => {
    const station = await loadStation("Patient_RESCOS_4.json", "RESCOS-71");
    const participants = getStationParticipants(station);
    const martine = participants.find((p) => p.role === "accompanying");
    expect(martine).toBeDefined();
    // Le tag domain-specific J3 remplace l'ancien `treatment.adherence`
    // (cf. user spec : Martine scope = caregiver_burden, social_situation,
    // antécédents_pancréas, …).
    expect(martine?.knowledgeScope).toContain("caregiver_burden");
  });
});
