// Phase 4 J4 — audit déclaratif des 5 stations pilotes multi-profils.
//
// Pour chaque pilote, on vérifie sur le VRAI catalogue (initCatalog,
// pas de mock fs ni LLM) que :
//   • participants[2] avec un patient + un accompanying,
//   • defaultSpeakerId conforme à l'attendu (patient pour ado/adulte,
//     accompanying pour bébé / pré-verbal / palliatif),
//   • participantSections est présent quand le scénario porte une
//     information secrète (RESCOS-70 trifecta + RESCOS-71 consignes_jeu),
//   • participantSections est ABSENT quand pas nécessaire (RESCOS-9b/13/63 :
//     pas de secret côté ado/parent, formats antérieurs sans
//     consignes_jeu/motif_cache à filtrer ; documenté dans
//     docs/multi-participants.md).
//
// Ces tests verrouillent la convention de fixtures et alertent
// immédiatement si un nouveau pilote est mal annoté (ex. règle
// participantSections oubliée sur un cas avec secret).

import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { initCatalog } from "../services/stationsService";
import { getPatientBrief } from "../services/patientService";

const PATIENT_DIR = path.resolve(__dirname, "..", "data", "patient");

async function loadStationRaw(file: string, shortId: string): Promise<any> {
  const raw = await fs.readFile(path.join(PATIENT_DIR, file), "utf-8");
  const parsed = JSON.parse(raw) as { stations: Array<{ id: string }> };
  return parsed.stations.find((s) => s.id.startsWith(shortId + " "));
}

interface PilotExpectation {
  shortId: string;
  file: string;
  expectedDefaultSpeakerId: string;
  expectedHasCloisonnement: boolean;
  cloisonnementRationale: string;
}

const PILOTS: PilotExpectation[] = [
  {
    shortId: "RESCOS-70",
    file: "Patient_RESCOS_4.json",
    expectedDefaultSpeakerId: "emma",
    expectedHasCloisonnement: true,
    cloisonnementRationale:
      "Trifecta canon B1 : pilule cachée à la mère ⇒ cloisonnement strict requis",
  },
  {
    shortId: "RESCOS-71",
    file: "Patient_RESCOS_4.json",
    expectedDefaultSpeakerId: "martine",
    expectedHasCloisonnement: true,
    cloisonnementRationale:
      "Patient muet (Louis 78 ans, terminal) ⇒ Martine relaie. consignes_jeu réservées au profil principal",
  },
  {
    shortId: "RESCOS-9b",
    file: "Patient_RESCOS_1.json",
    expectedDefaultSpeakerId: "parent",
    expectedHasCloisonnement: false,
    cloisonnementRationale:
      "Pédiatrie locomoteur — bébé pré-verbal ⇒ tout passe par le parent. Aucun secret partagé / asymétrique. Format JSON antérieur sans champ consignes_jeu/motif_cache",
  },
  {
    shortId: "RESCOS-13",
    file: "Patient_RESCOS_1.json",
    expectedDefaultSpeakerId: "patient",
    expectedHasCloisonnement: false,
    cloisonnementRationale:
      "Dépression jeune adulte 20 ans — la mère apporte un éclairage comportemental, pas un secret asymétrique. Format JSON antérieur",
  },
  {
    shortId: "RESCOS-63",
    file: "Patient_RESCOS_4.json",
    expectedDefaultSpeakerId: "parent",
    expectedHasCloisonnement: false,
    cloisonnementRationale:
      "Toux nourrisson 5 mois — bébé pré-verbal ⇒ parent répond. Aucun secret asymétrique. Format JSON antérieur",
  },
];

describe("Fixtures pilotes multi-profils — audit déclaratif (Phase 4 J4)", () => {
  it.each(PILOTS)(
    "$shortId : participants[2] (patient + accompanying)",
    async ({ shortId, file }) => {
      const station = await loadStationRaw(file, shortId);
      expect(Array.isArray(station.participants)).toBe(true);
      expect(station.participants).toHaveLength(2);
      const roles = station.participants.map((p: { role: string }) => p.role).sort();
      expect(roles).toEqual(["accompanying", "patient"]);
    },
  );

  it.each(PILOTS)(
    "$shortId : defaultSpeakerId = $expectedDefaultSpeakerId via getPatientBrief",
    async ({ shortId, expectedDefaultSpeakerId }) => {
      await initCatalog();
      const brief = await getPatientBrief(shortId);
      expect(brief.defaultSpeakerId).toBe(expectedDefaultSpeakerId);
    },
  );

  it.each(PILOTS)(
    "$shortId : présence/absence de participantSections cohérente avec le scénario ($cloisonnementRationale)",
    async ({ shortId, file, expectedHasCloisonnement }) => {
      const station = await loadStationRaw(file, shortId);
      const hasRules =
        station.participantSections !== undefined &&
        Object.keys(station.participantSections).length > 0;
      expect(hasRules).toBe(expectedHasCloisonnement);
    },
  );

  it("RESCOS-70 : couvre les 4 axes sensibles (full_scenario, sexual_health, contraception, school)", async () => {
    const station = await loadStationRaw("Patient_RESCOS_4.json", "RESCOS-70");
    const tagsUsed = new Set<string>();
    for (const tags of Object.values(station.participantSections ?? {}) as string[][]) {
      for (const t of tags) tagsUsed.add(t);
    }
    // Tous ces tags doivent avoir au moins une règle qui les utilise —
    // sinon le filtre est aveugle sur l'axe correspondant.
    expect(tagsUsed.has("full_scenario")).toBe(true);
    expect(tagsUsed.has("sexual_health")).toBe(true);
    expect(tagsUsed.has("contraception")).toBe(true);
    expect(tagsUsed.has("school")).toBe(true);
  });

  it("Tous les pilotes : tous les tags utilisés dans participantSections sont couverts par ≥ 1 participant", async () => {
    // Le validateur boot fait déjà ce check, mais on double-asserte ici
    // au niveau test pour qu'une régression apparaisse même si le
    // validateur est désactivé en dev.
    for (const { shortId, file } of PILOTS) {
      const station = await loadStationRaw(file, shortId);
      if (!station.participantSections) continue;
      const allTags = new Set<string>();
      for (const p of station.participants) for (const t of p.knowledgeScope) allTags.add(t);
      for (const [path, requiredTags] of Object.entries(
        station.participantSections,
      ) as [string, string[]][]) {
        for (const t of requiredTags) {
          expect(allTags.has(t), `${shortId} ${path} → tag « ${t} » non couvert`).toBe(true);
        }
      }
    }
  });
});
