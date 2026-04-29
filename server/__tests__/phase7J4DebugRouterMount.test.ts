// Phase 7 J4 — verrou intégration sur le mount du router debug.
//
// Contexte : en J3, l'endpoint /api/debug/evaluation-weights renvoyait 404
// runtime côté Replit alors que les unit tests phase7J3.test.ts passaient.
// Cause racine : `tsx watch` ne hot-reload PAS l'ajout d'un nouveau
// router import — le process Replit tournait encore avec l'ancien
// `mountApiRoutes` sans la ligne `app.use("/api/debug", debugRouter)`.
// Pas un bug code (le mount EST correct dans routes.ts), mais un bug
// process (kill complet du Replit nécessaire après ajout d'un router).
//
// Ce fichier verrouille la classe entière de bugs « router oublié au
// runtime » via des tests d'intégration end-to-end : on boote l'app
// COMPLÈTE (registerRoutes via buildTestApp, qui exerce le MÊME chemin
// de code qu'au runtime sauf le bind TCP) et on exerce les 5 cas de la
// spec via supertest. Garantit que la chaîne mount → router.get →
// handler est intacte. Si quelqu'un retire le `app.use("/api/debug",
// debugRouter)` de routes.ts, ces tests cassent immédiatement avec un
// message clair (contrairement aux tests J3 qui pourraient continuer
// de passer en faux positif via un router déjà déclaré).
//
// Pas de boot HTTP réel (port + listen) parce qu'on doit pouvoir tourner
// en parallèle dans vitest sans port collision. buildTestApp utilise la
// MÊME fonction mountApiRoutes que registerRoutes au runtime — la seule
// différence est l'absence de loadConfig + initCatalog côté test (dont
// la 2e est appelée en beforeAll). C'est suffisant pour catcher le mount.

import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { initCatalog } from "../services/stationsService";
import { buildTestApp } from "./helpers";

beforeAll(async () => {
  await initCatalog();
});

// ─── End-to-end : boot complet de l'app via buildTestApp + 5 cas spec ───
//
// buildTestApp() instancie une vraie app Express et appelle mountApiRoutes
// — exactement ce que registerRoutes() fait au runtime. Ces 5 cas
// répliquent la spec J4 Sujet 1 (Test A) et catchent toute régression
// future qui retirerait le router debug du mount.

describe("Phase 7 J4 — Sujet 1 : 5 cas end-to-end runtime du debug router", () => {
  it("GET /api/debug/evaluation-weights?stationId=AMBOSS-1 → 200 + JSON valide (no legal)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/debug/evaluation-weights?stationId=AMBOSS-1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      stationId: "AMBOSS-1",
      hasLegalContext: false,
      stationType: "anamnese_examen",
    });
    expect(res.body.weights).toMatchObject({ medico_legal: 0 });
    expect(res.body.sumWeights).toBe(100);
  });

  it("GET /api/debug/evaluation-weights?stationId=AMBOSS-24 → 200 + JSON valide (with legal)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/debug/evaluation-weights?stationId=AMBOSS-24");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      stationId: "AMBOSS-24",
      hasLegalContext: true,
      stationType: "anamnese_examen",
    });
    expect(res.body.weights.medico_legal).toBe(10);
    expect(res.body.sumWeights).toBeCloseTo(100, 10);
  });

  it("GET /api/debug/evaluation-weights?stationId=NONEXISTENT-XYZ → 404", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/debug/evaluation-weights?stationId=NONEXISTENT-XYZ");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });

  it("GET /api/debug/evaluation-weights (sans stationId) → 400 bad_request", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/debug/evaluation-weights");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });

  it("NODE_ENV=production → 404 indistinguable d'une route absente", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = buildTestApp();
      const res = await request(app).get("/api/debug/evaluation-weights?stationId=AMBOSS-1");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("not_found");
      // La response NE doit PAS contenir le payload debug réel : pas de
      // stationType inféré, pas de hasLegalContext, pas de poids
      // numériques. Le 404 doit être structurellement indistinguable
      // d'une route inexistante côté observateur externe.
      const bodyText = JSON.stringify(res.body);
      expect(bodyText).not.toContain("stationType");
      expect(bodyText).not.toContain("hasLegalContext");
      expect(bodyText).not.toContain("sumWeights");
      expect(bodyText).not.toContain("anamnese_examen");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
