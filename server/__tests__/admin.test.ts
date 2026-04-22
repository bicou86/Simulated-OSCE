// Tests /api/admin/stats : auth X-Admin-Key + agrégation (totals / byDay / byRoute / byModel).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// Mock SDKs pour éviter tout appel réseau.
vi.mock("openai", () => {
  class OpenAI { chat = { completions: { create: vi.fn() } }; audio = { transcriptions: { create: vi.fn() }, speech: { create: vi.fn() } }; models = { list: vi.fn() }; constructor(_: unknown) {} }
  return { default: OpenAI, toFile: vi.fn() };
});
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic { messages = { create: vi.fn() }; constructor(_: unknown) {} }
  return { default: Anthropic };
});

// Config : expose un ADMIN_KEY fixe pour les tests.
vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(async () => {}),
  getOpenAIKey: () => "",
  getAnthropicKey: () => "",
  setKeys: vi.fn(async () => {}),
  isConfigured: () => false,
  getAdminKey: () => "test-admin-key",
}));

// Mock readLog pour injecter un jeu d'entrées connu.
const mockEntries: any[] = [];
vi.mock("../lib/logger", async () => {
  const actual = await vi.importActual<typeof import("../lib/logger")>("../lib/logger");
  return {
    ...actual,
    readLog: vi.fn(async () => mockEntries),
  };
});

import { buildTestApp } from "./helpers";

// Timestamps décalés par heures pour être déterministes quelle que soit l'heure d'exécution.
function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

describe("GET /api/admin/stats — auth", () => {
  beforeEach(() => { mockEntries.length = 0; });
  afterEach(() => vi.clearAllMocks());

  it("401 without header", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/admin/stats");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("unauthorized");
  });

  it("401 with wrong key", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/api/admin/stats")
      .set("X-Admin-Key", "wrong");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("unauthorized");
  });

  it("200 with correct key", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/api/admin/stats")
      .set("X-Admin-Key", "test-admin-key");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totals");
    expect(res.body).toHaveProperty("byDay");
    expect(res.body).toHaveProperty("byRoute");
    expect(res.body).toHaveProperty("byModel");
  });

  it("400 on invalid ?days", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/api/admin/stats?days=abc")
      .set("X-Admin-Key", "test-admin-key");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/stats — aggregation", () => {
  beforeEach(() => {
    mockEntries.length = 0;
    mockEntries.push(
      {
        ts: isoHoursAgo(1), route: "/api/patient/chat", model: "gpt-4o-mini",
        tokensIn: 1000, tokensOut: 500, cachedTokens: 0, latencyMs: 100, costUsd: 0.001, ok: true,
      },
      {
        ts: isoHoursAgo(3), route: "/api/patient/chat/stream", model: "gpt-4o-mini",
        tokensIn: 2000, tokensOut: 800, cachedTokens: 0, latencyMs: 150, costUsd: 0.002, ok: true,
      },
      // 50h = au-delà de 24h mais dans les 7j.
      {
        ts: isoHoursAgo(50), route: "/api/evaluator/evaluate", model: "claude-sonnet-4-5",
        tokensIn: 5000, tokensOut: 1500, cachedTokens: 3000, latencyMs: 3000, costUsd: 0.025, ok: true,
      },
      // Hors fenêtre 7j (10 jours = 240h).
      {
        ts: isoHoursAgo(240), route: "/api/patient/chat", model: "gpt-4o-mini",
        tokensIn: 999, tokensOut: 999, cachedTokens: 0, latencyMs: 50, costUsd: 0.5, ok: true,
      },
    );
  });
  afterEach(() => vi.clearAllMocks());

  it("aggregates totals / byRoute / byModel / byDay within ?days=7", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/api/admin/stats?days=7")
      .set("X-Admin-Key", "test-admin-key");

    expect(res.status).toBe(200);
    expect(res.body.period.days).toBe(7);

    // Totals : 3 calls dans la fenêtre, 1 hors.
    expect(res.body.totals.calls).toBe(3);
    expect(res.body.totals.tokensIn).toBe(1000 + 2000 + 5000);
    expect(res.body.totals.tokensOut).toBe(500 + 800 + 1500);
    expect(res.body.totals.cachedTokens).toBe(3000);
    expect(res.body.totals.costUsd).toBeCloseTo(0.001 + 0.002 + 0.025, 6);

    const byRoute: any[] = res.body.byRoute;
    const chat = byRoute.find((b) => b.route === "/api/patient/chat");
    const stream = byRoute.find((b) => b.route === "/api/patient/chat/stream");
    const evalr = byRoute.find((b) => b.route === "/api/evaluator/evaluate");
    expect(chat.calls).toBe(1);
    expect(stream.calls).toBe(1);
    expect(evalr.calls).toBe(1);

    const byModel: any[] = res.body.byModel;
    const mini = byModel.find((b) => b.model === "gpt-4o-mini");
    const claude = byModel.find((b) => b.model === "claude-sonnet-4-5");
    expect(mini.calls).toBe(2);
    expect(claude.calls).toBe(1);

    const byDay: any[] = res.body.byDay;
    // Selon l'heure UTC courante, on peut avoir 1 ou 2 buckets ; vérifie simplement
    // que la somme des calls sur byDay = totals.calls.
    const totalDayCalls = byDay.reduce((sum, d) => sum + d.calls, 0);
    expect(totalDayCalls).toBe(3);
  });

  it("?days=1 restricts to last 24h", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/api/admin/stats?days=1")
      .set("X-Admin-Key", "test-admin-key");
    expect(res.status).toBe(200);
    // Seules les 2 entrées iso(0) (12h UTC aujourd'hui) sont dans les 24h.
    expect(res.body.totals.calls).toBe(2);
  });
});
