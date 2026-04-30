// Phase 8 J1 — tests du schéma additif `parentStationId` (stations
// doubles partie 1 + partie 2) et du validateur référentiel
// `validateParentStationIds` côté `stationsService`.
//
// Couvre :
//   1. Schéma Zod : station avec `parentStationId` valide → parse OK.
//   2. Schéma Zod : station sans `parentStationId` → parse OK
//      (rétrocompat, default undefined).
//   3. Schéma Zod : `parentStationId` chaîne vide → rejeté.
//   4. Schéma Zod : `parentStationId` non-string → rejeté.
//   5. Invariant additif : ajouter `parentStationId` ne perturbe ni les
//      participants, ni le legalContext, ni le medicoLegalReviewed
//      (les champs Phase 4/5/6 restent intacts).
//   6. Snapshot catalogue : les fixtures historiques (Phase 4-7) parsent
//      toujours via stationSchema, et AUCUNE n'a `parentStationId` —
//      preuve que J1 est strictement additif (aucune fixture modifiée).
//   7. Validateur référentiel : station avec `parentStationId` pointant
//      vers un shortId inconnu ⇒ erreur explicite.
//   8. Validateur référentiel : station avec `parentStationId` pointant
//      vers un shortId existant ⇒ aucun erreur.
//   9. Validateur référentiel : aucune station avec `parentStationId`
//      ⇒ aucun erreur (rétrocompat).
//
// Aucun LLM, parsing 100 % Zod déterministe (invariant ECOS).

import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { stationSchema } from "@shared/station-schema";
import { __test__ } from "../services/stationsService";

const PATIENT_DIR = path.resolve(__dirname, "..", "data", "patient");

describe("stationSchema — parentStationId (Phase 8 J1)", () => {
  it("station avec parentStationId valide → parse OK", () => {
    const r = stationSchema.safeParse({
      id: "RESCOS-64-P2",
      parentStationId: "RESCOS-64-P1",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.parentStationId).toBe("RESCOS-64-P1");
  });

  it("station sans parentStationId → parse OK (rétrocompat, undefined)", () => {
    const r = stationSchema.safeParse({
      id: "RESCOS-1",
      patient_description: "Mr X",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.parentStationId).toBeUndefined();
  });

  it("parentStationId chaîne vide → rejeté", () => {
    const r = stationSchema.safeParse({
      id: "X",
      parentStationId: "",
    });
    expect(r.success).toBe(false);
  });

  it("parentStationId non-string (number) → rejeté", () => {
    const r = stationSchema.safeParse({
      id: "X",
      parentStationId: 42,
    });
    expect(r.success).toBe(false);
  });

  it("invariant additif : ajout de parentStationId ne perturbe pas les champs Phase 4/5/6", () => {
    // Une station fictive qui exerce TOUS les champs additifs des phases
    // précédentes en parallèle de parentStationId — vérifie que le
    // schéma reste cohérent et qu'aucun champ n'est rebaptisé / supprimé.
    const r = stationSchema.safeParse({
      id: "FAKE-DOUBLE-P2",
      parentStationId: "FAKE-DOUBLE-P1",
      participants: [
        {
          id: "p1",
          role: "patient",
          name: "Patient X",
          vocabulary: "lay",
          knowledgeScope: ["self.symptoms"],
        },
      ],
      participantSections: { contexte: ["self.symptoms"] },
      legalContext: undefined,
      medicoLegalReviewed: true,
      // champ legacy passthrough
      patient_description: "Description libre",
      contexte: "story",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.parentStationId).toBe("FAKE-DOUBLE-P1");
      expect(r.data.participants).toHaveLength(1);
      expect(r.data.participantSections).toEqual({ contexte: ["self.symptoms"] });
      expect(r.data.medicoLegalReviewed).toBe(true);
      // Champ legacy préservé via .passthrough()
      expect((r.data as Record<string, unknown>).patient_description).toBe(
        "Description libre",
      );
    }
  });
});

describe("stationSchema — snapshot catalogue post-Phase 7 (Phase 8 J1)", () => {
  it("toutes les fixtures historiques parsent et aucune ne porte parentStationId (additif strict)", async () => {
    // Lit directement les Patient_*.json sans passer par stationsService
    // pour rester focalisé sur le schéma Zod (et permettre l'audit même
    // sur les fixtures « doublon » comme RESCOS-64 partie 2 qui est
    // ignorée par le catalog).
    const files = (await fs.readdir(PATIENT_DIR))
      .filter((f) => f.startsWith("Patient_") && f.endsWith(".json"))
      .sort();
    let count = 0;
    const errors: string[] = [];
    const withParentStationId: string[] = [];
    for (const f of files) {
      const txt = await fs.readFile(path.join(PATIENT_DIR, f), "utf-8");
      const parsed = JSON.parse(txt) as { stations: Array<Record<string, unknown>> };
      for (const s of parsed.stations) {
        count++;
        const r = stationSchema.safeParse(s);
        if (!r.success) {
          errors.push(`[${s.id as string}] ${r.error.message}`);
          continue;
        }
        // Aucune fixture historique ne doit déclarer parentStationId :
        // J1 pose le champ schéma mais ne touche PAS les fixtures.
        if (r.data.parentStationId !== undefined) {
          withParentStationId.push(s.id as string);
        }
      }
    }
    // Aucune erreur de parsing.
    expect(errors).toEqual([]);
    // Aucun parentStationId présent dans les fixtures.
    expect(withParentStationId).toEqual([]);
    // Sanité : on a effectivement parcouru tout le corpus (≥ 287
    // stations physiques, RESCOS-64 partie 1 et partie 2 comptent ici
    // pour 2 stations physiques distinctes — l'audit ne dédup pas).
    expect(count).toBeGreaterThanOrEqual(287);
  });
});

describe("checkParentStationIdReferences (Phase 8 J1, fonction pure)", () => {
  const checkParentStationIdReferences = __test__.checkParentStationIdReferences;

  it("station avec parentStationId pointant vers shortId inconnu → erreur explicite", () => {
    const errors = checkParentStationIdReferences(
      [
        {
          fullId: "X-1 - Ghost ref",
          parentStationId: "MISSING-X",
        },
      ],
      new Set(["RESCOS-1", "RESCOS-2"]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/parentStationId points to unknown station/);
    expect(errors[0]).toMatch(/MISSING-X/);
    expect(errors[0]).toMatch(/X-1 - Ghost ref/);
  });

  it("station avec parentStationId pointant vers shortId existant → 0 erreur", () => {
    const errors = checkParentStationIdReferences(
      [
        {
          fullId: "RESCOS-64-P2 - Toux - Présentation pneumologue",
          parentStationId: "RESCOS-64-P1",
        },
      ],
      new Set(["RESCOS-64-P1", "RESCOS-1"]),
    );
    expect(errors).toEqual([]);
  });

  it("station sans parentStationId → 0 erreur (rétrocompat)", () => {
    const errors = checkParentStationIdReferences(
      [
        { fullId: "RESCOS-1 - Foo", parentStationId: undefined },
        { fullId: "RESCOS-2 - Bar" },
      ],
      new Set(["RESCOS-1", "RESCOS-2"]),
    );
    expect(errors).toEqual([]);
  });

  it("agrège plusieurs erreurs avant retour (UX boot)", () => {
    const errors = checkParentStationIdReferences(
      [
        { fullId: "X-1 - bad", parentStationId: "MISSING-1" },
        { fullId: "X-2 - bad", parentStationId: "MISSING-2" },
        { fullId: "X-3 - ok", parentStationId: "RESCOS-1" },
      ],
      new Set(["RESCOS-1"]),
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/MISSING-1/);
    expect(errors[1]).toMatch(/MISSING-2/);
  });
});
