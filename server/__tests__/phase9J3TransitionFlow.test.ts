// Phase 9 J3 — Bug 2 transition automatique P1 → P2 stations doubles.
//
// Couvre :
//   • Helper `findChildStations(parentShortId)` côté stationsService :
//     retourne RESCOS-64-P2 pour parent "RESCOS-64", tableau vide pour
//     les 286 stations classiques sans P2.
//   • `getPatientBrief()` propage `nextPartStationId` :
//       — RESCOS-64 (P1) → "RESCOS-64-P2"
//       — RESCOS-64-P2 (P2) → undefined (pas de P3)
//       — RESCOS-1, AMBOSS-24, USMLE-34, RESCOS-72 (témoins) → undefined
//   • Endpoint GET /api/patient/RESCOS-64/brief : nouvelle baseline
//     682 bytes UTF-8 (vs 647 Phase 8 J2 : delta +35 = ajout
//     `"nextPartStationId":"RESCOS-64-P2"`).
//   • Baselines des autres stations strictement inchangées :
//       RESCOS-64-P2 = 781 (Phase 9 J4 : +30 = ajout parentStationId,
//         Q-A10 ; était 751 en Phase 9 J2/J3),
//       AMBOSS-24 = 528, USMLE-34 = 540, USMLE Triage 39 = 513,
//       USMLE-9 = 509, RESCOS-72 = 717.
//   • Schéma additif strict : `nextPartStationId` n'apparaît dans le
//     JSON brief HTTP que pour les stations P1 ayant une P2.
//   • Zéro LLM dans la détection (heuristique pure : filtre
//     `parentStationId === id` ET suffixe `/-P2$/`).

import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import {
  initCatalog,
  findChildStations,
  listStations,
  getStationMeta,
} from "../services/stationsService";
import { getPatientBrief } from "../services/patientService";
import { buildTestApp } from "./helpers";

beforeAll(async () => {
  await initCatalog();
});

// ────────────────────────────────────────────────────────────────────────
// 1. Helper findChildStations
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J3 — findChildStations(parentShortId)", () => {
  it("RESCOS-64 → 1 station enfant (RESCOS-64-P2)", () => {
    const children = findChildStations("RESCOS-64");
    expect(children.length).toBe(1);
    expect(children[0].id).toBe("RESCOS-64-P2");
    expect(children[0].parentStationId).toBe("RESCOS-64");
  });

  it("RESCOS-64-P2 (la P2 elle-même) → aucun enfant (pas de P3)", () => {
    expect(findChildStations("RESCOS-64-P2")).toEqual([]);
  });

  it("RESCOS-1 (mono-station classique) → aucun enfant", () => {
    expect(findChildStations("RESCOS-1")).toEqual([]);
  });

  it("AMBOSS-24 (témoin Phase 7 legal) → aucun enfant", () => {
    expect(findChildStations("AMBOSS-24")).toEqual([]);
  });

  it("shortId inconnu → aucun enfant (pas de crash)", () => {
    expect(findChildStations("INEXISTANT-9999")).toEqual([]);
  });

  it("audit corpus : exactement 1 station enfant détectée sur 288 stations (RESCOS-64-P2)", () => {
    const all = listStations();
    let totalChildren = 0;
    for (const meta of all) {
      totalChildren += findChildStations(meta.id).length;
    }
    expect(totalChildren).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. getPatientBrief — propagation nextPartStationId
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J3 — getPatientBrief (propagation nextPartStationId)", () => {
  it("RESCOS-64 (P1) expose nextPartStationId === \"RESCOS-64-P2\"", async () => {
    const brief = await getPatientBrief("RESCOS-64");
    expect(brief.nextPartStationId).toBe("RESCOS-64-P2");
  });

  it("RESCOS-64-P2 (P2 elle-même) n'expose PAS nextPartStationId", async () => {
    const brief = await getPatientBrief("RESCOS-64-P2");
    expect(brief.nextPartStationId).toBeUndefined();
  });

  it("RESCOS-1 (mono-station classique) n'expose PAS nextPartStationId (rétrocompat)", async () => {
    const brief = await getPatientBrief("RESCOS-1");
    expect(brief.nextPartStationId).toBeUndefined();
  });

  it("AMBOSS-24 (témoin Phase 7 legal) n'expose PAS nextPartStationId", async () => {
    const brief = await getPatientBrief("AMBOSS-24");
    expect(brief.nextPartStationId).toBeUndefined();
  });

  it("USMLE-34 (témoin Phase 7 legal) n'expose PAS nextPartStationId", async () => {
    const brief = await getPatientBrief("USMLE-34");
    expect(brief.nextPartStationId).toBeUndefined();
  });

  it("RESCOS-72 (témoin Phase 8 J4) n'expose PAS nextPartStationId", async () => {
    const brief = await getPatientBrief("RESCOS-72");
    expect(brief.nextPartStationId).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. Endpoint GET /api/patient/:id/brief — baselines byteLength
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J3 — endpoint /api/patient/:id/brief baselines post-J3", () => {
  it("GET /api/patient/RESCOS-64/brief : 682 bytes UTF-8 (baseline Phase 9 J3, +35 vs Phase 8 J2 = ajout nextPartStationId)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-64/brief");
    expect(res.status).toBe(200);
    expect(res.body.nextPartStationId).toBe("RESCOS-64-P2");
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(682);
  });

  it("GET /api/patient/RESCOS-64-P2/brief : 781 bytes UTF-8 (baseline Phase 9 J4, +30 vs J2/J3 = ajout parentStationId Q-A10)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-64-P2/brief");
    expect(res.status).toBe(200);
    expect(res.body.nextPartStationId).toBeUndefined();
    // Phase 9 J4 : RESCOS-64-P2 expose désormais `parentStationId: "RESCOS-64"`
    // (additif strict, ajout +30 bytes UTF-8 = `,"parentStationId":"RESCOS-64"`).
    expect(res.body.parentStationId).toBe("RESCOS-64");
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(781);
  });

  it("GET /api/patient/AMBOSS-24/brief : 528 bytes UTF-8 (non-régression Phase 7 stricte)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/AMBOSS-24/brief");
    expect(res.status).toBe(200);
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(528);
  });

  it("GET /api/patient/USMLE-34/brief : 540 bytes UTF-8 (non-régression Phase 7 stricte)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/USMLE-34/brief");
    expect(res.status).toBe(200);
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(540);
  });

  it("GET /api/patient/USMLE-9/brief : 509 bytes UTF-8 (non-régression Phase 7 stricte)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/USMLE-9/brief");
    expect(res.status).toBe(200);
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(509);
  });

  it("GET /api/patient/RESCOS-72/brief : 717 bytes UTF-8 (non-régression Phase 8 J4 stricte)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-72/brief");
    expect(res.status).toBe(200);
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(717);
  });

  it("brief partie 2 : parentStationId désormais exposé (Phase 9 J4 Q-A10) — META_FIELDS_TO_STRIP côté <station_data> LLM patient inchangé", async () => {
    // Phase 8 J2 : on strippait `parentStationId` du brief HTTP par défense.
    // Phase 9 J4 (Q-A10 validée user) : on expose ce champ POUR LES P2
    // uniquement, parce que la dette 7 (bilan combiné UI) en a besoin
    // pour lire le résultat P1 dans sessionStorage. La défense côté
    // injection LLM est inchangée : `parentStationId` reste dans
    // META_FIELDS_TO_STRIP / stripLegalContextOnly côté <station_data>,
    // donc le LLM patient ne voit jamais ce champ.
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-64-P2/brief");
    expect(res.status).toBe(200);
    expect(res.body.parentStationId).toBe("RESCOS-64");
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. Catalog : préservation invariants Phase 8
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J3 — catalog : invariants Phase 8 préservés", () => {
  it("288 stations indexées (288 = 287 héritées + 1 RESCOS-64-P2)", () => {
    expect(listStations().length).toBe(288);
  });

  it("RESCOS-64 et RESCOS-64-P2 distinctes dans le catalog", () => {
    const p1 = getStationMeta("RESCOS-64");
    const p2 = getStationMeta("RESCOS-64-P2");
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(p1!.parentStationId).toBeUndefined();
    expect(p2!.parentStationId).toBe("RESCOS-64");
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. Helpers client part1Evaluation (sessionStorage)
// ────────────────────────────────────────────────────────────────────────

import {
  part1EvalStorageKey,
  PART1_EVAL_STORAGE_PREFIX,
  writePart1EvaluationRecord,
  readPart1EvaluationRecord,
  type Part1EvaluationRecord,
} from "../../client/src/lib/part1Evaluation";

describe("Phase 9 J3 — helpers part1Evaluation (sessionStorage)", () => {
  it("part1EvalStorageKey : préfixe + stationId", () => {
    expect(part1EvalStorageKey("RESCOS-64")).toBe(`${PART1_EVAL_STORAGE_PREFIX}RESCOS-64`);
    expect(part1EvalStorageKey("RESCOS-64-P2")).toBe(`${PART1_EVAL_STORAGE_PREFIX}RESCOS-64-P2`);
  });

  it("préfixe ≠ préfixe transcript (clés sessionStorage distinctes)", () => {
    // `osce.eval.${id}` vs `osce.session.${id}` : aucun risque
    // d'écrasement entre transcript (Phase 4 legacy) et évaluation P1
    // (Phase 9 J3).
    expect(PART1_EVAL_STORAGE_PREFIX).toBe("osce.eval.");
    expect(PART1_EVAL_STORAGE_PREFIX).not.toBe("osce.session.");
  });

  it("writePart1EvaluationRecord + readPart1EvaluationRecord : roundtrip", () => {
    // Mock sessionStorage si environnement vitest sans DOM.
    const memoryStore = new Map<string, string>();
    const mockSession = {
      getItem: (k: string) => memoryStore.get(k) ?? null,
      setItem: (k: string, v: string) => { memoryStore.set(k, v); },
      removeItem: (k: string) => { memoryStore.delete(k); },
      clear: () => memoryStore.clear(),
      key: () => null,
      length: 0,
    };
    // @ts-expect-error — assignation sessionStorage globale dans le test
    globalThis.sessionStorage = mockSession;

    const record: Part1EvaluationRecord = {
      stationId: "RESCOS-64",
      evaluatorResult: null,
      legalEvaluation: null,
      timestamp: 1234567890,
      error: null,
    };
    writePart1EvaluationRecord(record);
    const read = readPart1EvaluationRecord("RESCOS-64");
    expect(read).toEqual(record);
  });

  it("readPart1EvaluationRecord : retourne null si clé absente", () => {
    const memoryStore = new Map<string, string>();
    // @ts-expect-error — assignation sessionStorage globale dans le test
    globalThis.sessionStorage = {
      getItem: (k: string) => memoryStore.get(k) ?? null,
      setItem: (k: string, v: string) => { memoryStore.set(k, v); },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    expect(readPart1EvaluationRecord("STATION-INEXISTANTE")).toBeNull();
  });

  it("readPart1EvaluationRecord : retourne null si JSON malformé (robustesse)", () => {
    const memoryStore = new Map<string, string>();
    memoryStore.set("osce.eval.STATION-CORRUPTED", "{not-json");
    // @ts-expect-error — assignation sessionStorage globale dans le test
    globalThis.sessionStorage = {
      getItem: (k: string) => memoryStore.get(k) ?? null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    expect(readPart1EvaluationRecord("STATION-CORRUPTED")).toBeNull();
  });
});
