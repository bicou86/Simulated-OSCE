// Phase 9 J4 — Q-A10 : exposition de `parentStationId` dans le brief HTTP
// patient pour les stations doubles partie 2 (RESCOS-64-P2 en J4).
//
// Couvre :
//   • getPatientBrief() propage `parentStationId` depuis le meta catalog :
//       — RESCOS-64-P2 → "RESCOS-64"
//       — RESCOS-64 (P1) → undefined (pas de parent)
//       — AMBOSS-24, USMLE-34, USMLE-9, RESCOS-72 (témoins classiques)
//         → undefined
//   • Endpoint GET /api/patient/RESCOS-64-P2/brief : nouvelle baseline
//     UTF-8 = 781 bytes (vs 751 Phase 9 J2/J3, delta +30 = ajout
//     `,"parentStationId":"RESCOS-64"`).
//   • Baselines des 5 stations témoins strictement inchangées :
//       RESCOS-64 = 682 (Phase 9 J3, nextPartStationId présent),
//       AMBOSS-24 = 528, USMLE-34 = 540, USMLE-9 = 509, RESCOS-72 = 717.
//   • /api/evaluator/weights : payload strictement identique pré/post-J4
//     (additif strict : aucune modification de la table statique 5 axes).

import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { initCatalog } from "../services/stationsService";
import { getPatientBrief } from "../services/patientService";
import { buildTestApp } from "./helpers";
import {
  EVALUATION_AXES,
  EVALUATION_WEIGHTS,
} from "../../shared/evaluation-weights";

beforeAll(async () => {
  await initCatalog();
});

// ────────────────────────────────────────────────────────────────────────
// 1. getPatientBrief — propagation parentStationId
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J4 — getPatientBrief (propagation parentStationId Q-A10)", () => {
  it("RESCOS-64-P2 expose parentStationId === \"RESCOS-64\"", async () => {
    const brief = await getPatientBrief("RESCOS-64-P2");
    expect(brief.parentStationId).toBe("RESCOS-64");
  });

  it("RESCOS-64 (P1, pas de parent) → parentStationId undefined", async () => {
    const brief = await getPatientBrief("RESCOS-64");
    expect(brief.parentStationId).toBeUndefined();
  });

  it("AMBOSS-24 (témoin Phase 7 legal classique) → parentStationId undefined", async () => {
    const brief = await getPatientBrief("AMBOSS-24");
    expect(brief.parentStationId).toBeUndefined();
  });

  it("USMLE-34 (témoin classique) → parentStationId undefined", async () => {
    const brief = await getPatientBrief("USMLE-34");
    expect(brief.parentStationId).toBeUndefined();
  });

  it("USMLE-9 (témoin classique) → parentStationId undefined", async () => {
    const brief = await getPatientBrief("USMLE-9");
    expect(brief.parentStationId).toBeUndefined();
  });

  it("RESCOS-72 (témoin Phase 8 legal+grille) → parentStationId undefined", async () => {
    const brief = await getPatientBrief("RESCOS-72");
    expect(brief.parentStationId).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. Endpoint /api/patient/:id/brief — baselines byteLength post-J4
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J4 — endpoint /api/patient/:id/brief baselines post-Q-A10", () => {
  it("GET /api/patient/RESCOS-64-P2/brief : 781 bytes UTF-8 (baseline Phase 9 J4 ; +30 vs J2/J3 = ajout parentStationId)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-64-P2/brief");
    expect(res.status).toBe(200);
    expect(res.body.parentStationId).toBe("RESCOS-64");
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(781);
  });

  it("GET /api/patient/RESCOS-64/brief : 682 bytes UTF-8 (baseline Phase 9 J3 inchangée, parentStationId omis sur P1)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-64/brief");
    expect(res.status).toBe(200);
    expect(res.body.parentStationId).toBeUndefined();
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(682);
  });

  it("GET /api/patient/AMBOSS-24/brief : 528 bytes UTF-8 (non-régression Phase 7 stricte)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/AMBOSS-24/brief");
    expect(res.status).toBe(200);
    expect(res.body.parentStationId).toBeUndefined();
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(528);
  });

  it("GET /api/patient/USMLE-34/brief : 540 bytes UTF-8 (non-régression Phase 7 stricte)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/USMLE-34/brief");
    expect(res.status).toBe(200);
    expect(res.body.parentStationId).toBeUndefined();
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(540);
  });

  it("GET /api/patient/USMLE-9/brief : 509 bytes UTF-8 (non-régression Phase 7 stricte)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/USMLE-9/brief");
    expect(res.status).toBe(200);
    expect(res.body.parentStationId).toBeUndefined();
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(509);
  });

  it("GET /api/patient/RESCOS-72/brief : 717 bytes UTF-8 (non-régression Phase 8 J4 stricte)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-72/brief");
    expect(res.status).toBe(200);
    expect(res.body.parentStationId).toBeUndefined();
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(717);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. /api/evaluator/weights — invariant additif strict (Bug 1 invariant 6)
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J4 — /api/evaluator/weights inchangé (Bug 1 invariant 6)", () => {
  it("GET /api/evaluator/weights : payload strictement identique au pré-J4 (table v1 5-axes)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/evaluator/weights");
    expect(res.status).toBe(200);
    // Forme exacte attendue : { axes, weights } avec exactement la table
    // statique base v1 (anamnese_examen, bbn, psy, pediatrie_accompagnant,
    // teleconsultation, triage). Aucun rééchelonnage legalContext (la
    // route ne prend pas de paramètre stationId, c'est un fallback de
    // robustesse côté UI).
    expect(res.body.axes).toEqual(EVALUATION_AXES);
    expect(res.body.weights).toEqual(EVALUATION_WEIGHTS);
    // Garde-fou bug 1 : la table doit toujours porter la valeur base v1
    // pour anamnese_examen.anamnese (25, pas 22.5).
    expect(res.body.weights.anamnese_examen.anamnese).toBe(25);
  });
});
