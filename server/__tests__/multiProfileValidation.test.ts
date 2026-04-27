// Phase 4 J3 — tests unitaires du validateur strict
// `validateMultiProfileStations`.
//
// On simule des fixtures de stations multi-profils sur disque (via mocks
// fs) et on vérifie que :
//   • un chemin référencé mais inexistant ⇒ erreur explicite,
//   • un tag référencé mais absent de tous les knowledgeScope ⇒ erreur,
//   • une station valide ne déclenche aucune erreur,
//   • plusieurs erreurs sont agrégées avant le throw final (UX boot).
//
// Les tests appellent l'export `__test__.validateMultiProfileStations`
// directement plutôt que de passer par `initCatalog` pour rester ciblés.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("fs", async () => {
  const actual = await vi.importActual<any>("fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
      readdir: vi.fn(),
    },
  };
});

import { promises as fs } from "fs";
import { __test__ } from "../services/stationsService";

const validateMultiProfileStations = __test__.validateMultiProfileStations;

function fixture(stations: any[]): string {
  return JSON.stringify({ source: "TEST", stations });
}

beforeEach(() => {
  vi.mocked(fs.readFile).mockReset();
});

describe("validateMultiProfileStations — Phase 4 J3", () => {
  it("station valide (chemins présents + tags couverts) ⇒ no throw", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      fixture([
        {
          id: "OK-1",
          contexte: "story",
          participants: [
            { id: "p1", role: "patient", name: "P1", vocabulary: "lay", knowledgeScope: ["full"] },
            { id: "p2", role: "accompanying", name: "P2", vocabulary: "lay", knowledgeScope: ["limited"] },
          ],
          participantSections: { contexte: ["full"] },
        },
      ]),
    );
    await expect(validateMultiProfileStations(["Patient_TEST.json"])).resolves.toBeUndefined();
  });

  it("chemin inexistant ⇒ throw avec message explicite", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      fixture([
        {
          id: "BAD-PATH",
          contexte: "story",
          participants: [
            { id: "p1", role: "patient", name: "P1", vocabulary: "lay", knowledgeScope: ["full"] },
          ],
          participantSections: { ghost_field: ["full"] },
        },
      ]),
    );
    await expect(validateMultiProfileStations(["Patient_TEST.json"])).rejects.toThrow(
      /chemin « ghost_field » introuvable/,
    );
  });

  it("tag absent de tous les scopes ⇒ throw avec message explicite", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      fixture([
        {
          id: "BAD-TAG",
          contexte: "story",
          participants: [
            { id: "p1", role: "patient", name: "P1", vocabulary: "lay", knowledgeScope: ["a"] },
            { id: "p2", role: "accompanying", name: "P2", vocabulary: "lay", knowledgeScope: ["b"] },
          ],
          participantSections: { contexte: ["c"] },
        },
      ]),
    );
    await expect(validateMultiProfileStations(["Patient_TEST.json"])).rejects.toThrow(
      /tag « c » .* absent de tous les participant\.knowledgeScope/,
    );
  });

  it("agrège plusieurs erreurs avant de throw", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      fixture([
        {
          id: "MULTI-FAIL",
          contexte: "story",
          participants: [
            { id: "p1", role: "patient", name: "P1", vocabulary: "lay", knowledgeScope: ["a"] },
          ],
          participantSections: { ghost_field: ["a"], contexte: ["zzz"] },
        },
      ]),
    );
    try {
      await validateMultiProfileStations(["Patient_TEST.json"]);
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      // Les deux erreurs doivent apparaître dans le message agrégé.
      expect(msg).toMatch(/ghost_field/);
      expect(msg).toMatch(/zzz/);
    }
  });

  it("station sans participantSections ⇒ no throw (rétrocompat mono-patient)", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      fixture([
        {
          id: "MONO-1",
          patient_description: "Mr. X",
          // pas de participants, pas de participantSections → pas de validation J3.
        },
      ]),
    );
    await expect(validateMultiProfileStations(["Patient_TEST.json"])).resolves.toBeUndefined();
  });

  it("chemin .a.b à 2 niveaux (sous-section) ⇒ accepté quand présent", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      fixture([
        {
          id: "TWO-LEVEL",
          antecedents: { gyneco: "..." },
          participants: [
            { id: "p1", role: "patient", name: "P1", vocabulary: "lay", knowledgeScope: ["intime"] },
          ],
          participantSections: { "antecedents.gyneco": ["intime"] },
        },
      ]),
    );
    await expect(validateMultiProfileStations(["Patient_TEST.json"])).resolves.toBeUndefined();
  });
});
