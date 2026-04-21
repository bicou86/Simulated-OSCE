// Tests de la route /api/evaluator/evaluate — Claude est mocké.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("openai", () => {
  class OpenAI {
    models = { list: vi.fn() };
    audio = {
      transcriptions: { create: vi.fn() },
      speech: { create: vi.fn() },
    };
    chat = { completions: { create: vi.fn() } };
    constructor(_opts: unknown) {}
  }
  return { default: OpenAI, toFile: vi.fn() };
});

const anthropicCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    messages = { create: anthropicCreate };
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

import { buildTestApp } from "./helpers";

const VALID_REPORT = {
  globalScore: 82,
  anamnese: 85,
  examen: 75,
  communication: 90,
  diagnostic: 80,
  strengths: ["Salutation et mise en confiance."],
  criticalOmissions: ["A oublié les allergies médicamenteuses."],
  priorities: ["Systématiser la question des allergies."],
  verdict: "Réussi",
};

describe("POST /api/evaluator/evaluate", () => {
  beforeEach(() => {
    configMocks.anthropic = "sk-ant";
  });

  afterEach(() => vi.clearAllMocks());

  it("returns the parsed report on a clean JSON response", async () => {
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(VALID_REPORT) }],
    });
    const app = buildTestApp();
    const res = await request(app).post("/api/evaluator/evaluate").send({
      station: { scenario: "Douleur thoracique" },
      transcript: [
        { role: "doctor", text: "Bonjour" },
        { role: "patient", text: "J'ai mal" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(VALID_REPORT);
    expect(anthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-4-5" }),
    );
  });

  it("unwraps a ```json fenced block before parsing", async () => {
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "```json\n" + JSON.stringify(VALID_REPORT) + "\n```" }],
    });
    const app = buildTestApp();
    const res = await request(app).post("/api/evaluator/evaluate").send({
      station: { scenario: "Test" },
      transcript: [{ role: "doctor", text: "hi" }],
    });
    expect(res.status).toBe(200);
    expect(res.body.globalScore).toBe(82);
  });

  it("502 when the model returns non-JSON", async () => {
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "I cannot answer." }],
    });
    const app = buildTestApp();
    const res = await request(app).post("/api/evaluator/evaluate").send({
      station: { scenario: "Test" },
      transcript: [{ role: "doctor", text: "hi" }],
    });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("upstream_error");
  });

  it("502 when JSON violates the schema", async () => {
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ ...VALID_REPORT, verdict: "Inconnu" }) }],
    });
    const app = buildTestApp();
    const res = await request(app).post("/api/evaluator/evaluate").send({
      station: { scenario: "Test" },
      transcript: [{ role: "doctor", text: "hi" }],
    });
    expect(res.status).toBe(502);
  });

  it("412 when Anthropic key is missing", async () => {
    configMocks.anthropic = "";
    const app = buildTestApp();
    const res = await request(app).post("/api/evaluator/evaluate").send({
      station: { scenario: "Test" },
      transcript: [{ role: "doctor", text: "hi" }],
    });
    expect(res.status).toBe(412);
    expect(res.body.code).toBe("not_configured");
  });

  it("400 on malformed payload", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/evaluator/evaluate").send({ transcript: [] });
    expect(res.status).toBe(400);
  });
});
