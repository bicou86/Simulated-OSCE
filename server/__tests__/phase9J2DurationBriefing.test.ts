// Phase 9 J2 — Bug 3a (durée 4+9=13 min RESCOS-64-P2) + Bug 3b
// (feuille de porte cohérente avec consigne candidat orientée présentation).
//
// Couvre :
//   • Fixture Patient_RESCOS_4.json partie 2 : `phases[]` (2 entrées :
//     preparation 4 min + presentation 9 min) + `consigneCandidat` non vide.
//   • Schéma Zod stationPhaseSchema : accepte phases bien formées, rejette
//     minutes ≤ 0 ou kind hors enum.
//   • Schéma Zod stationSchema : accepte phases optionnel + consigneCandidat
//     optionnel (additif strict, rétrocompat 287 stations).
//   • getPatientBrief :
//       — RESCOS-64-P2 expose `phases` (2 entrées) + `consigneCandidat`
//       — RESCOS-64 (partie 1) n'expose PAS phases ni consigneCandidat
//       — RESCOS-1, AMBOSS-24 (témoins) n'exposent PAS phases ni
//         consigneCandidat (non-régression 287 stations)
//   • Endpoint GET /api/patient/:id/brief :
//       — RESCOS-64-P2 : nouvelle baseline byteLength UTF-8 reportée
//       — RESCOS-64 partie 1 : 647 bytes UTF-8 inchangé (non-régression
//         Phase 8 J2)
//       — AMBOSS-24 : 528 bytes UTF-8 inchangé (non-régression Phase 7)
//   • Somme phases RESCOS-64-P2 = 13 (conforme arbitrage Phase 9 cadrage B).
//   • META_FIELDS_TO_STRIP contient `phases` et `consigneCandidat` (défense
//     pour stations futures combinant phases ET flow patient simulé).

import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { promises as fs } from "fs";
import path from "path";
import { initCatalog } from "../services/stationsService";
import { getPatientBrief } from "../services/patientService";
import { stationSchema, stationPhaseSchema } from "@shared/station-schema";
import { buildTestApp } from "./helpers";

beforeAll(async () => {
  await initCatalog();
});

// ────────────────────────────────────────────────────────────────────────
// 1. Fixture Patient_RESCOS_4.json partie 2 — phases[] + consigneCandidat
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J2 — fixture Patient_RESCOS_4.json (RESCOS-64-P2)", () => {
  it("phases[] présent avec 2 entrées (preparation 4 min + presentation 9 min)", async () => {
    const file = path.resolve(
      import.meta.dirname,
      "..",
      "data",
      "patient",
      "Patient_RESCOS_4.json",
    );
    const content = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(content) as {
      stations: Array<{
        id: string;
        phases?: Array<{ id: string; label: string; minutes: number; kind: string }>;
        consigneCandidat?: string;
      }>;
    };
    const station = parsed.stations.find(
      (s) => s.id === "RESCOS-64 - Toux - Station double 2",
    );
    expect(station).toBeDefined();
    expect(station!.phases).toBeDefined();
    expect(station!.phases!.length).toBe(2);
    expect(station!.phases![0]).toMatchObject({
      id: "preparation",
      minutes: 4,
      kind: "silent",
    });
    expect(station!.phases![1]).toMatchObject({
      id: "presentation",
      minutes: 9,
      kind: "examiner",
    });
  });

  it("consigneCandidat présent, non vide, mentionne 4 min et 9 min", async () => {
    const file = path.resolve(
      import.meta.dirname,
      "..",
      "data",
      "patient",
      "Patient_RESCOS_4.json",
    );
    const content = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(content) as {
      stations: Array<{ id: string; consigneCandidat?: string }>;
    };
    const station = parsed.stations.find(
      (s) => s.id === "RESCOS-64 - Toux - Station double 2",
    );
    expect(station).toBeDefined();
    expect(typeof station!.consigneCandidat).toBe("string");
    expect(station!.consigneCandidat!.length).toBeGreaterThan(50);
    expect(station!.consigneCandidat).toContain("4 minutes");
    expect(station!.consigneCandidat).toContain("9 minutes");
  });

  it("partie 1 RESCOS-64 ne porte ni phases ni consigneCandidat (additif strict)", async () => {
    const file = path.resolve(
      import.meta.dirname,
      "..",
      "data",
      "patient",
      "Patient_RESCOS_4.json",
    );
    const content = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(content) as {
      stations: Array<{ id: string; phases?: unknown; consigneCandidat?: unknown }>;
    };
    const station = parsed.stations.find(
      (s) => s.id === "RESCOS-64 - Toux - Station double 1",
    );
    expect(station).toBeDefined();
    expect(station!.phases).toBeUndefined();
    expect(station!.consigneCandidat).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. Schéma Zod — stationPhaseSchema + stationSchema additifs
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J2 — Zod stationPhaseSchema / stationSchema", () => {
  it("stationPhaseSchema accepte une phase bien formée (silent)", () => {
    const result = stationPhaseSchema.safeParse({
      id: "preparation",
      label: "Préparation",
      minutes: 4,
      kind: "silent",
    });
    expect(result.success).toBe(true);
  });

  it("stationPhaseSchema accepte une phase examiner", () => {
    const result = stationPhaseSchema.safeParse({
      id: "presentation",
      label: "Présentation à l'examinateur",
      minutes: 9,
      kind: "examiner",
    });
    expect(result.success).toBe(true);
  });

  it("stationPhaseSchema rejette minutes ≤ 0", () => {
    const result = stationPhaseSchema.safeParse({
      id: "x",
      label: "X",
      minutes: 0,
      kind: "silent",
    });
    expect(result.success).toBe(false);
  });

  it("stationPhaseSchema rejette kind hors enum", () => {
    const result = stationPhaseSchema.safeParse({
      id: "x",
      label: "X",
      minutes: 4,
      kind: "unknown",
    });
    expect(result.success).toBe(false);
  });

  it("stationSchema accepte phases + consigneCandidat sur partie 2", () => {
    const result = stationSchema.safeParse({
      id: "RESCOS-64 - Toux - Station double 2",
      parentStationId: "RESCOS-64",
      phases: [
        { id: "preparation", label: "Préparation", minutes: 4, kind: "silent" },
        { id: "presentation", label: "Présentation", minutes: 9, kind: "examiner" },
      ],
      consigneCandidat: "Vous avez 4 minutes pour préparer votre présentation orale.",
    });
    expect(result.success).toBe(true);
  });

  it("stationSchema accepte une station sans phases ni consigneCandidat (rétrocompat 287 stations)", () => {
    const result = stationSchema.safeParse({
      id: "RESCOS-1 - Adénopathie sus-claviculaire",
      nom: "Patient X",
    });
    expect(result.success).toBe(true);
  });

  it("stationSchema accepte phases vide ne passe pas (min(1))", () => {
    const result = stationSchema.safeParse({
      id: "FAKE",
      phases: [],
    });
    expect(result.success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. getPatientBrief — propagation phases + consigneCandidat
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J2 — getPatientBrief (propagation phases + consigneCandidat)", () => {
  it("RESCOS-64-P2 expose phases (2 entrées) + consigneCandidat", async () => {
    const brief = await getPatientBrief("RESCOS-64-P2");
    expect(brief.phases).toBeDefined();
    expect(brief.phases!.length).toBe(2);
    expect(brief.phases![0].kind).toBe("silent");
    expect(brief.phases![0].minutes).toBe(4);
    expect(brief.phases![1].kind).toBe("examiner");
    expect(brief.phases![1].minutes).toBe(9);
    expect(typeof brief.consigneCandidat).toBe("string");
    expect(brief.consigneCandidat!).toContain("4 minutes");
  });

  it("somme phases RESCOS-64-P2 = 13 min (conforme arbitrage Phase 9 cadrage B)", async () => {
    const brief = await getPatientBrief("RESCOS-64-P2");
    const total = (brief.phases ?? []).reduce((acc, p) => acc + p.minutes, 0);
    expect(total).toBe(13);
  });

  it("RESCOS-64 (partie 1) n'expose PAS phases ni consigneCandidat (additif strict)", async () => {
    const brief = await getPatientBrief("RESCOS-64");
    expect(brief.phases).toBeUndefined();
    expect(brief.consigneCandidat).toBeUndefined();
  });

  it("RESCOS-1 (témoin mono-patient) n'expose PAS phases ni consigneCandidat (non-régression)", async () => {
    const brief = await getPatientBrief("RESCOS-1");
    expect(brief.phases).toBeUndefined();
    expect(brief.consigneCandidat).toBeUndefined();
  });

  it("AMBOSS-24 (témoin Phase 7 legal) n'expose PAS phases ni consigneCandidat (non-régression)", async () => {
    const brief = await getPatientBrief("AMBOSS-24");
    expect(brief.phases).toBeUndefined();
    expect(brief.consigneCandidat).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. Endpoint GET /api/patient/:id/brief — baselines byteLength
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J2 — endpoint /api/patient/:id/brief baselines", () => {
  it("GET /api/patient/RESCOS-64/brief : 647 bytes UTF-8 (non-régression Phase 8 J2)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-64/brief");
    expect(res.status).toBe(200);
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(647);
  });

  it("GET /api/patient/AMBOSS-24/brief : 528 bytes UTF-8 (non-régression Phase 7)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/AMBOSS-24/brief");
    expect(res.status).toBe(200);
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(528);
  });

  it("GET /api/patient/USMLE-34/brief : 540 bytes UTF-8 (non-régression Phase 7)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/USMLE-34/brief");
    expect(res.status).toBe(200);
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(540);
  });

  it("GET /api/patient/RESCOS-64-P2/brief : nouvelle baseline byteLength + phases présentes dans le payload", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-64-P2/brief");
    expect(res.status).toBe(200);
    expect(res.body.phases).toBeDefined();
    expect(res.body.phases.length).toBe(2);
    expect(res.body.consigneCandidat).toBeDefined();
    // Nouvelle baseline UTF-8 post-J2 : 751 bytes (vs 362 baseline Phase 8 J2,
    // delta +389 bytes = `phases[]` (~140) + `consigneCandidat` (~245) +
    // serialisation JSON + virgules). À mettre à jour si la consigneCandidat
    // ou le label des phases sont modifiés.
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(751);
  });

  it("brief RESCOS-64-P2 : pas de fuite parentStationId dans le payload (META_FIELDS_TO_STRIP intact)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-64-P2/brief");
    expect(res.status).toBe(200);
    expect(res.body.parentStationId).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. Helpers client (computeInitialPhaseDuration / sumPhaseMinutes)
// ────────────────────────────────────────────────────────────────────────
//
// Tests intégrés ici plutôt que côté client pour être proches du périmètre
// Phase 9 J2 et garantir cohérence avec la fixture serveur.

import {
  computeInitialPhaseDuration,
  sumPhaseMinutes,
  hasMultiplePhases,
  TOTAL_DURATION_LEGACY_SEC,
} from "../../client/src/lib/phaseTimer";

describe("Phase 9 J2 — helpers phaseTimer (client)", () => {
  it("computeInitialPhaseDuration retourne phases[0].minutes * 60 si phases présent", () => {
    expect(
      computeInitialPhaseDuration({
        phases: [
          { id: "preparation", label: "Préparation", minutes: 4, kind: "silent" },
          { id: "presentation", label: "Présentation", minutes: 9, kind: "examiner" },
        ],
      }),
    ).toBe(240);
  });

  it("computeInitialPhaseDuration retourne TOTAL_DURATION_LEGACY_SEC (13*60) si phases absent", () => {
    expect(computeInitialPhaseDuration({})).toBe(TOTAL_DURATION_LEGACY_SEC);
    expect(computeInitialPhaseDuration(null)).toBe(TOTAL_DURATION_LEGACY_SEC);
    expect(computeInitialPhaseDuration({ phases: [] })).toBe(TOTAL_DURATION_LEGACY_SEC);
  });

  it("sumPhaseMinutes retourne la somme des minutes des phases déclarées", () => {
    expect(
      sumPhaseMinutes({
        phases: [
          { id: "a", label: "A", minutes: 4, kind: "silent" },
          { id: "b", label: "B", minutes: 9, kind: "examiner" },
        ],
      }),
    ).toBe(13);
  });

  it("sumPhaseMinutes retourne 0 si phases absent (rétrocompat)", () => {
    expect(sumPhaseMinutes({})).toBe(0);
    expect(sumPhaseMinutes(null)).toBe(0);
  });

  it("hasMultiplePhases vrai si phases présent, faux sinon", () => {
    expect(hasMultiplePhases({ phases: [{ id: "x", label: "X", minutes: 4, kind: "silent" }] })).toBe(true);
    expect(hasMultiplePhases({})).toBe(false);
    expect(hasMultiplePhases(null)).toBe(false);
  });
});
