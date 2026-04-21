// Tests des routes /api/settings avec SDK mockés (aucun appel réseau réel).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// ─────────────── Mocks des SDK ───────────────

const openaiModelsList = vi.fn();
vi.mock("openai", () => {
  class OpenAI {
    models = { list: openaiModelsList };
    audio = {
      transcriptions: { create: vi.fn() },
      speech: { create: vi.fn() },
    };
    chat = { completions: { create: vi.fn() } };
    constructor(_opts: unknown) {}
  }
  return {
    default: OpenAI,
    toFile: vi.fn(async (buf: Buffer, name: string, opts: { type?: string } = {}) => ({
      name,
      type: opts.type ?? "audio/webm",
      buffer: buf,
    })),
  };
});

const anthropicCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    messages = { create: anthropicCreate };
    constructor(_opts: unknown) {}
  }
  return { default: Anthropic };
});

// Mock des getters de clés pour contrôler l'état du store depuis les tests.
const configMocks = {
  openai: "sk-test-openai",
  anthropic: "sk-ant-test",
};
vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(async () => {}),
  getOpenAIKey: () => configMocks.openai,
  getAnthropicKey: () => configMocks.anthropic,
  setKeys: vi.fn(async () => {}),
  isConfigured: (provider: "openai" | "anthropic") =>
    provider === "openai" ? !!configMocks.openai : !!configMocks.anthropic,
}));

// L'import doit venir APRÈS les mocks.
import { buildTestApp } from "./helpers";

describe("POST /api/settings", () => {
  beforeEach(() => {
    configMocks.openai = "sk-test-openai";
    configMocks.anthropic = "sk-ant-test";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("400 when body is invalid", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/settings").send({ persist: "not-a-boolean" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "bad_request" });
  });

  it("200 with flags when keys are accepted", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/settings")
      .send({ openaiKey: "sk-abc", anthropicKey: "sk-ant-xyz", persist: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      persisted: false,
      openaiConfigured: true,
      anthropicConfigured: true,
    });
  });
});

describe("GET /api/settings/status", () => {
  beforeEach(() => {
    configMocks.openai = "sk-test-openai";
    configMocks.anthropic = "sk-ant-test";
  });

  afterEach(() => vi.clearAllMocks());

  it("reports both ok when both providers respond", async () => {
    openaiModelsList.mockResolvedValue({ data: [] });
    anthropicCreate.mockResolvedValue({ content: [] });
    const app = buildTestApp();
    const res = await request(app).get("/api/settings/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ openai_ok: true, anthropic_ok: true });
  });

  it("reports not_configured when a key is missing", async () => {
    configMocks.openai = "";
    anthropicCreate.mockResolvedValue({ content: [] });
    const app = buildTestApp();
    const res = await request(app).get("/api/settings/status");
    expect(res.status).toBe(200);
    expect(res.body.openai_ok).toBe(false);
    expect(res.body.openai_reason).toBe("not_configured");
    expect(res.body.anthropic_ok).toBe(true);
  });

  it("maps 401 from provider to unauthorized reason", async () => {
    openaiModelsList.mockRejectedValue(Object.assign(new Error("unauthorized"), { status: 401 }));
    anthropicCreate.mockResolvedValue({ content: [] });
    const app = buildTestApp();
    const res = await request(app).get("/api/settings/status");
    expect(res.body.openai_ok).toBe(false);
    expect(res.body.openai_reason).toBe("unauthorized");
  });
});
