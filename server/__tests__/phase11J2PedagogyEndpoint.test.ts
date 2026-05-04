// Phase 11 J2 — tests d'intégration de l'endpoint
// GET /api/patient/:stationId/pedagogy + invariants I13/I14 cross-référencés.
//
// Stratégie de mock (A6) : on mock UNIQUEMENT `getPatientStation` côté
// patientService via `vi.mock` + `vi.importActual` pour préserver tous
// les autres exports (notamment `getPatientBrief` qui doit continuer à
// utiliser le vrai catalog pour les baselines byteLength HTTP). Le mock
// est conditionnel : tant que `mockStationOverride` est null, on délègue
// à l'implémentation réelle (zéro effet sur les baselines RESCOS-64-P2,
// RESCOS-72, etc.). Quand un test pose `mockStationOverride = {...}`,
// l'appel suivant retourne ce payload mocké.
//
// Couvre :
//   1. Station mockée avec pedagogicalContent complet → 200 + payload
//   2. Station réelle sans pedagogicalContent → 200 + null
//   3. Station inconnue → 400 + code "bad_request"
//   4. Header Cache-Control: no-store présent
//   5. Invariant I13 cross-référencé : /brief de RESCOS-64-P2 ne contient
//      AUCUN champ pedagogicalContent (station réelle, pas de mock)
//   6. Non-régression baseline RESCOS-64-P2 = 781 bytes UTF-8
//   7. Non-régression baseline RESCOS-72 = 717 bytes UTF-8
//   8. pedagogicalContent malformé en base → 500 (Zod throw, mappé
//      sur internal_error par le routeur)

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// État partagé pour le mock conditionnel de getPatientStation. Quand non
// null, l'appel mocké retourne ce payload au lieu de déléguer au vrai
// service. Réinitialisé après chaque test (afterEach + restoreMocks).
let mockStationOverride: unknown | null = null;

vi.mock("../services/patientService", async () => {
  const actual = await vi.importActual<typeof import("../services/patientService")>(
    "../services/patientService",
  );
  return {
    ...actual,
    getPatientStation: vi.fn(async (id: string) => {
      if (mockStationOverride !== null) return mockStationOverride;
      return actual.getPatientStation(id);
    }),
  };
});

import { initCatalog } from "../services/stationsService";
import { buildTestApp } from "./helpers";

beforeAll(async () => {
  await initCatalog();
});

afterEach(() => {
  mockStationOverride = null;
});

describe("Phase 11 J2 — GET /api/patient/:stationId/pedagogy", () => {
  it("station mockée avec pedagogicalContent complet → 200 + payload mock", async () => {
    const pedagogicalContent = {
      resume: { title: "Résumé clinique", body: "Cas typique d'angor stable." },
      presentation: { title: "Présentation type", body: "Douleur rétrosternale à l'effort." },
      theory: { title: "Théorie", body: "Score TIMI / GRACE, drapeaux rouges." },
      images: [
        {
          data: "/pedagogical-images/ecg-angor-stable.jpg",
          caption: "ECG inter-critique normal",
          alt: "ECG",
        },
      ],
    };
    mockStationOverride = {
      id: "RESCOS-1 - Mock - test pédagogie",
      pedagogicalContent,
    };
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-1/pedagogy");
    expect(res.status).toBe(200);
    expect(res.body.stationId).toBe("RESCOS-1");
    expect(res.body.pedagogicalContent).toEqual(pedagogicalContent);
  });

  it("station réelle sans pedagogicalContent → 200 + pedagogicalContent: null", async () => {
    // Station réelle (pas de mock) : aucune fixture J2 n'a encore de
    // pedagogicalContent (J3 fera la migration). On attend null.
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-1/pedagogy");
    expect(res.status).toBe(200);
    expect(res.body.stationId).toBe("RESCOS-1");
    expect(res.body.pedagogicalContent).toBeNull();
  });

  it("station inconnue → 400 + code « bad_request »", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/INEXISTANT/pedagogy");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
    expect(res.body.error).toMatch(/INEXISTANT/);
  });

  it("header Cache-Control: no-store présent sur 200", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-1/pedagogy");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("invariant I13 — /brief de RESCOS-64-P2 ne contient AUCUN champ pedagogicalContent (station réelle)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-64-P2/brief");
    expect(res.status).toBe(200);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain("pedagogicalContent");
  });

  it("non-régression baseline byteLength : /brief RESCOS-64-P2 = 781 B UTF-8 (Phase 9 J4 figée)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-64-P2/brief");
    expect(res.status).toBe(200);
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(781);
  });

  it("non-régression baseline byteLength : /brief RESCOS-72 = 717 B UTF-8 (Phase 7 J4 figée)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-72/brief");
    expect(res.status).toBe(200);
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(717);
  });

  it("pedagogicalContent malformé en base → 500 (Zod throw mappé sur internal_error)", async () => {
    // Mock d'une station avec un pedagogicalContent malformé (data non
    // conforme à la regex pedagogicalImagePathSchema). Le service
    // appelle .parse() qui throw ; le routeur convertit en 500
    // internal_error (cf. patient.ts route /pedagogy).
    mockStationOverride = {
      id: "RESCOS-1 - Mock malformé",
      pedagogicalContent: {
        images: [{ data: "https://evil.example.com/pwn.jpg" }],
      },
    };
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-1/pedagogy");
    expect(res.status).toBe(500);
    expect(res.body.code).toBe("internal_error");
  });
});
