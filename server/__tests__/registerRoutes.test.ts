// Test d'intégration HTTP de `registerRoutes` — boot l'app réelle (moins Vite)
// et frappe les endpoints via supertest pour vérifier que :
//   1) chaque /api/* est accessible (Content-Type application/json, pas
//      d'interception par un éventuel catch-all en aval).
//   2) un /api/* non enregistré renvoie un JSON 404 (garde défensif), pas du
//      HTML — ce qui aurait attrapé en CI le bug "Unexpected token '<'".
//   3) l'ordre de montage des routers est celui attendu (la régression
//      consistait à ajouter un routeur dans routes.ts mais pas dans helpers —
//      maintenant que helpers.ts utilise mountApiRoutes, c'est impossible).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";

// Stub OpenAI / Anthropic pour que les imports des routes n'essaient pas
// d'ouvrir des connexions réelles.
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: vi.fn() } };
    audio = {
      transcriptions: { create: vi.fn() },
      speech: { create: vi.fn() },
    };
    models = { list: vi.fn() };
    constructor(_opts: unknown) {}
  }
  return { default: OpenAI, toFile: vi.fn() };
});
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    messages = { create: vi.fn() };
    constructor(_opts: unknown) {}
  }
  return { default: Anthropic };
});

const configMocks = { openai: "sk", anthropic: "sk-ant" };
vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(async () => {}),
  getOpenAIKey: () => configMocks.openai,
  getAnthropicKey: () => configMocks.anthropic,
  setKeys: vi.fn(async () => {}),
  isConfigured: () => true,
}));

// initCatalog lit les vrais Patient_*.json. Pour ce test on veut le vrai
// catalog (c'est lui qu'on veut valider), mais on peut aussi le neutraliser.
// On garde le vrai ici pour valider l'intégration complète.

import { registerRoutes } from "../routes";

async function makeApp(): Promise<express.Express> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  // On ne monte PAS de catch-all Vite ici (test d'intégration de l'API
  // uniquement), mais le garde 404 JSON de mountApiRoutes est déjà en place.
  return app;
}

beforeEach(() => {
  configMocks.openai = "sk";
  configMocks.anthropic = "sk-ant";
});
afterEach(() => vi.clearAllMocks());

describe("registerRoutes — intégration HTTP de l'app réelle", () => {
  it("/api/stations est accessible et renvoie du JSON", async () => {
    const app = await makeApp();
    const res = await request(app).get("/api/stations");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toHaveProperty("stations");
  });

  it("/api/examiner/lookup est accessible et renvoie du JSON (pas du HTML)", async () => {
    const app = await makeApp();
    // Station réelle : AMBOSS-1 a un examen_resultats avec Murphy.
    const res = await request(app)
      .post("/api/examiner/lookup")
      .send({ stationId: "AMBOSS-1", query: "je cherche le signe de Murphy" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(typeof res.body).toBe("object");
    expect(res.body).toHaveProperty("match");
    // Pas de HTML — si le catch-all SPA avait intercepté, on aurait eu
    // Content-Type text/html et res.body aurait été un Buffer/string.
    expect(JSON.stringify(res.body)).not.toMatch(/<!DOCTYPE/i);
  });

  it("/api/examiner/lookup est reachable sur plusieurs stations", async () => {
    const app = await makeApp();
    for (const id of ["AMBOSS-1", "RESCOS-1"]) {
      const res = await request(app)
        .post("/api/examiner/lookup")
        .send({ stationId: id, query: "palpation" });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    }
  });

  it("garde défensif : /api/route-inconnue renvoie JSON 404 (pas HTML)", async () => {
    const app = await makeApp();
    const res = await request(app).get("/api/route-inconnue");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.code).toBe("not_found");
    expect(res.body.error).toMatch(/API route not found/);
  });

  it("garde défensif : POST vers un sous-chemin /api/* inconnu → JSON 404", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/examiner/autre").send({});
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.code).toBe("not_found");
  });

  it("chacun des routers principaux répond en JSON (smoke test)", async () => {
    const app = await makeApp();
    const endpoints: Array<[string, "GET" | "POST"]> = [
      ["/api/stations", "GET"],
      ["/api/settings/status", "GET"],
    ];
    for (const [path, method] of endpoints) {
      const res = method === "GET" ? await request(app).get(path) : await request(app).post(path);
      expect(res.status, `${method} ${path}`).toBeLessThan(500);
      expect(res.headers["content-type"], `${method} ${path}`).toMatch(/application\/json/);
    }
  });

  // ─── Phase 4 J2 (fix sérialisation) — vérifie sur le vrai catalog que le
  // brief sérialisé via HTTP contient bien participants[] et
  // defaultSpeakerId pour les 5 stations pilotes annotées en J1, et
  // qu'à l'inverse les stations mono-patient legacy n'exposent PAS le
  // champ participants (il reste `undefined` ⇒ omis par JSON.stringify).
  describe("/api/patient/:id/brief — sérialisation participants[] (Phase 4 J2)", () => {
    const PILOTS_MULTI: Array<{ sid: string; expectedIds: string[]; expectedDefault: string }> = [
      { sid: "RESCOS-70", expectedIds: ["emma", "mother"], expectedDefault: "emma" },
      { sid: "RESCOS-71", expectedIds: ["louis", "martine"], expectedDefault: "martine" },
      { sid: "RESCOS-9b", expectedIds: ["charlotte", "parent"], expectedDefault: "parent" },
      { sid: "RESCOS-13", expectedIds: ["patient", "mother"], expectedDefault: "patient" },
      { sid: "RESCOS-63", expectedIds: ["liam", "parent"], expectedDefault: "parent" },
    ];

    for (const { sid, expectedIds, expectedDefault } of PILOTS_MULTI) {
      it(`${sid} → expose participants[2] + defaultSpeakerId="${expectedDefault}"`, async () => {
        const app = await makeApp();
        const res = await request(app).get(`/api/patient/${sid}/brief`);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/application\/json/);
        expect(Array.isArray(res.body.participants)).toBe(true);
        expect(res.body.participants).toHaveLength(2);
        const ids = res.body.participants.map((p: { id: string }) => p.id).sort();
        expect(ids).toEqual([...expectedIds].sort());
        // Chaque participant doit porter les champs obligatoires du schéma.
        for (const p of res.body.participants) {
          expect(typeof p.id).toBe("string");
          expect(typeof p.name).toBe("string");
          expect(["patient", "accompanying", "witness"]).toContain(p.role);
          expect(["medical", "lay"]).toContain(p.vocabulary);
          expect(Array.isArray(p.knowledgeScope)).toBe(true);
        }
        expect(res.body.defaultSpeakerId).toBe(expectedDefault);
      });
    }

    it("station mono-patient legacy (AMBOSS-1) → pas de participants dans la réponse", async () => {
      const app = await makeApp();
      const res = await request(app).get("/api/patient/AMBOSS-1/brief");
      expect(res.status).toBe(200);
      // `participants` est volontairement omis (undefined ⇒ JSON.stringify
      // le drop) pour conserver la rétrocompat 100 % des intégrations
      // pré-J2 qui consomment uniquement les champs legacy.
      expect(res.body.participants).toBeUndefined();
      // defaultSpeakerId reste exposé (= "patient" pour les mono).
      expect(res.body.defaultSpeakerId).toBe("patient");
    });

    it("station mono-patient legacy (RESCOS-1) → pas de participants dans la réponse", async () => {
      const app = await makeApp();
      const res = await request(app).get("/api/patient/RESCOS-1/brief");
      expect(res.status).toBe(200);
      expect(res.body.participants).toBeUndefined();
      expect(res.body.defaultSpeakerId).toBe("patient");
    });
  });

  // ─── Phase 5 J1 — vérifie sur le vrai catalog que /api/patient/:id/brief
  // N'EXPOSE JAMAIS `legalContext` (ni decision_rationale, ni
  // applicable_law, etc.). Le contexte médico-légal vit côté serveur
  // uniquement, lu par l'évaluateur via getLegalContext.
  describe("/api/patient/:id/brief — pas de fuite legalContext (Phase 5 J1)", () => {
    it.each([
      { sid: "AMBOSS-24", category: "secret_pro_levee" },
      { sid: "USMLE-34", category: "signalement_maltraitance" },
      { sid: "RESCOS-72", category: "certificat_complaisance" },
    ])(
      "$sid : aucune fuite legalContext / decision_rationale / applicable_law",
      async ({ sid }) => {
        const app = await makeApp();
        const res = await request(app).get(`/api/patient/${sid}/brief`);
        expect(res.status).toBe(200);
        expect(res.body.legalContext).toBeUndefined();
        expect(res.body.decision_rationale).toBeUndefined();
        expect(res.body.applicable_law).toBeUndefined();
        expect(res.body.expected_decision).toBeUndefined();
        expect(res.body.candidate_must_verbalize).toBeUndefined();
        expect(res.body.candidate_must_avoid).toBeUndefined();
        expect(res.body.mandatory_reporting).toBeUndefined();
        // Sérialisation JSON complète sans aucun mot-clé du schéma.
        const serialized = JSON.stringify(res.body);
        expect(serialized).not.toMatch(/legalContext/);
        expect(serialized).not.toMatch(/decision_rationale/);
        expect(serialized).not.toMatch(/CP-321/);
        expect(serialized).not.toMatch(/CP-318/);
      },
    );
  });

  describe("/api/patient/RESCOS-72 — la station de novo est bien servie", () => {
    it("RESCOS-72 expose un brief valide via /api/patient/RESCOS-72/brief", async () => {
      const app = await makeApp();
      const res = await request(app).get("/api/patient/RESCOS-72/brief");
      expect(res.status).toBe(200);
      expect(res.body.stationId).toBe("RESCOS-72");
      expect(res.body.patientDescription).toMatch(/Marc Bernard/);
      expect(res.body.setting).toMatch(/médecine générale/i);
      // La station apparaît dans /api/stations.
      const list = await request(app).get("/api/stations");
      expect(list.status).toBe(200);
      const ids = (list.body.stations as Array<{ id: string }>).map((s) => s.id);
      expect(ids).toContain("RESCOS-72");
    });
  });
});
