// Phase 10 J3 partie B — Dette 5 : suppression du bloc dormant `presentation`
// dans Patient_RESCOS_4.json (station RESCOS-64-P2).
//
// Couvre :
//   • Validation JSON post-suppression (parsing OK, 19 stations préservées).
//   • Absence de la clé `presentation` sur la station RESCOS-64-P2.
//   • Préservation byte-exact des 19 baselines briefs HTTP UTF-8 dérivées
//     du fichier modifié (mesurées en J3 partie B et lockées ici).
//   • Non-régression /api/evaluation/presentation : weightedScore reste
//     95.61 sur transcript artificiel RESCOS-64-P2 (parité Phase 10 J2).
//   • Brief HTTP RESCOS-64-P2 reste à 781 bytes UTF-8 (invariant 1).

import { describe, expect, it, beforeAll } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import request from "supertest";
import { initCatalog, listStations } from "../services/stationsService";
import { getPatientBrief } from "../services/patientService";
import { evaluatePresentation } from "../services/presentationEvaluator";
import { getEvaluatorStation } from "../services/evaluatorService";
import { __test__ as presTest } from "../services/presentationEvaluator";
import { buildTestApp } from "./helpers";

beforeAll(async () => {
  await initCatalog();
});

const PATIENT_RESCOS_4 = path.resolve(
  import.meta.dirname,
  "..",
  "data",
  "patient",
  "Patient_RESCOS_4.json",
);

// ────────────────────────────────────────────────────────────────────────
// 1. Validation JSON post-suppression
// ────────────────────────────────────────────────────────────────────────

describe("Phase 10 J3 partie B — Patient_RESCOS_4.json reste JSON-valide après suppression du bloc presentation", () => {
  it("Test 1 : JSON.parse réussit sans erreur", async () => {
    const content = await fs.readFile(PATIENT_RESCOS_4, "utf-8");
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it("Test 1bis : 19 stations préservées (nombre inchangé pré/post-suppression)", async () => {
    const content = await fs.readFile(PATIENT_RESCOS_4, "utf-8");
    const parsed = JSON.parse(content) as { stations: Array<{ id: string }> };
    expect(parsed.stations.length).toBe(19);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. Absence de la clé `presentation` sur RESCOS-64-P2
// ────────────────────────────────────────────────────────────────────────

describe("Phase 10 J3 partie B — clé `presentation` strictement absente de RESCOS-64-P2 (station double partie 2)", () => {
  it("Test 2 : Object.keys(stationRescos64P2).indexOf('presentation') === -1", async () => {
    const content = await fs.readFile(PATIENT_RESCOS_4, "utf-8");
    const parsed = JSON.parse(content) as { stations: Array<{ id: string } & Record<string, unknown>> };
    const p2 = parsed.stations.find(
      (s) => s.id === "RESCOS-64 - Toux - Station double 2",
    );
    expect(p2).toBeDefined();
    expect(Object.keys(p2!).indexOf("presentation")).toBe(-1);
    // Garde-fou : les autres champs essentiels de la station P2 sont préservés.
    for (const key of [
      "id", "setting", "patient_description", "consigneCandidat", "phases",
      "examen_resultats", "parentStationId", "medicoLegalReviewed",
    ]) {
      expect(Object.keys(p2!), `clé ${key} attendue`).toContain(key);
    }
  });

  it("Test 2bis : aucune autre station du fichier ne porte une clé `presentation` (cohérence corpus)", async () => {
    const content = await fs.readFile(PATIENT_RESCOS_4, "utf-8");
    const parsed = JSON.parse(content) as { stations: Array<Record<string, unknown>> };
    for (const station of parsed.stations) {
      expect(
        Object.keys(station).indexOf("presentation"),
        `station ${(station as { id: string }).id} ne doit pas porter "presentation"`,
      ).toBe(-1);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. Baselines briefs HTTP préservées byte-exact (19 stations dérivées)
// ────────────────────────────────────────────────────────────────────────

const BASELINES_RESCOS_4: ReadonlyArray<{ id: string; bytes: number }> = [
  { id: "RESCOS-57", bytes: 555 },
  { id: "RESCOS-57b", bytes: 754 },
  { id: "RESCOS-58", bytes: 707 },
  { id: "RESCOS-58b", bytes: 734 },
  { id: "RESCOS-59", bytes: 335 },
  { id: "RESCOS-60", bytes: 375 },
  { id: "RESCOS-61", bytes: 566 },
  { id: "RESCOS-62", bytes: 620 },
  { id: "RESCOS-63", bytes: 939 },
  { id: "RESCOS-64", bytes: 682 },
  { id: "RESCOS-64-P2", bytes: 781 },
  { id: "RESCOS-65", bytes: 519 },
  { id: "RESCOS-66", bytes: 550 },
  { id: "RESCOS-67", bytes: 691 },
  { id: "RESCOS-68", bytes: 587 },
  { id: "RESCOS-69", bytes: 633 },
  { id: "RESCOS-70", bytes: 1112 },
  { id: "RESCOS-71", bytes: 1329 },
  { id: "RESCOS-72", bytes: 717 },
];

describe("Phase 10 J3 partie B — 19 baselines briefs Patient_RESCOS_4 préservées byte-exact", () => {
  it("Test 3 : toutes les 19 stations dérivées parsent et leur brief HTTP correspond aux baselines lockées", async () => {
    const all = listStations().filter((s) => s.patientFile === "Patient_RESCOS_4.json");
    expect(all.length).toBe(19);
    for (const { id, bytes } of BASELINES_RESCOS_4) {
      const brief = await getPatientBrief(id);
      const measured = Buffer.byteLength(JSON.stringify(brief), "utf-8");
      expect(measured, `${id} attendu ${bytes} bytes`).toBe(bytes);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. Non-régression /api/evaluation/presentation : score 95.61 préservé
// ────────────────────────────────────────────────────────────────────────

describe("Phase 10 J3 partie B — non-régression /api/evaluation/presentation post-suppression bloc patient", () => {
  it("Test 4 : transcript artificiel RESCOS-64-P2 → weightedScore === 95.61 (parité Phase 10 J2 A-strict)", async () => {
    // Reconstruit le transcript synthétique Phase 8 J3 (cf. test
    // « transcript artificiel concaténant tous les items_attendus »
    // dans phase8J3PresentationEvaluator.test.ts) : la grille évaluateur
    // côté Examinateur_RESCOS_4.json est l'unique source consultée. Le
    // bloc patient supprimé n'a JAMAIS été lu par ce flow ; sa
    // suppression doit être strictement transparente sur le score.
    const evalStation = await getEvaluatorStation("RESCOS-64-P2");
    type Item = { id: string; text: string; binaryOnly?: boolean; scoringRule?: string; items_attendus?: string[] };
    const grille = (evalStation as { grille: Record<string, Item[]> }).grille;
    const parts: string[] = [];
    for (const axis of ["presentation", "raisonnement", "examens", "management"] as const) {
      for (const item of grille[axis]) {
        const itemsAttendus = item.items_attendus ?? [];
        if (itemsAttendus.length === 1 && /^aucun$/i.test(itemsAttendus[0].trim())) continue;
        if (item.binaryOnly === true && itemsAttendus.length === 0 && axis === "raisonnement") {
          const diag = presTest.extractDiagnostic(item.text);
          if (diag) parts.push(diag);
          continue;
        }
        if (itemsAttendus.length === 0) continue;
        parts.push(itemsAttendus[0]);
        if (item.scoringRule && item.binaryOnly !== true) {
          const parsed = presTest.parseScoringRule(item.scoringRule, item.id);
          if (parsed.mode === "token") {
            for (const step of parsed.steps) {
              if (step.kind === "token") parts.push((step as { token: string }).token);
            }
          }
        }
      }
    }
    const transcript = parts.join(". ") + ".";
    const r = await evaluatePresentation({ stationId: "RESCOS-64-P2", transcript });
    expect(r.weightedScore).toBeCloseTo(95.61, 2);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. Brief HTTP RESCOS-64-P2 = 781 bytes UTF-8 (invariant 1 strict)
// ────────────────────────────────────────────────────────────────────────

describe("Phase 10 J3 partie B — invariant 1 strict : brief HTTP RESCOS-64-P2 = 781 bytes UTF-8", () => {
  it("Test 5 : GET /api/patient/RESCOS-64-P2/brief = 781 bytes (suppression bloc presentation transparente sur le brief)", async () => {
    // getPatientBrief ne projette pas le bloc presentation dans le brief
    // HTTP (cf. construction explicite des champs retournés). La
    // suppression est donc strictement neutre sur la baseline UTF-8.
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-64-P2/brief");
    expect(res.status).toBe(200);
    expect(res.body.parentStationId).toBe("RESCOS-64");
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(781);
  });
});
