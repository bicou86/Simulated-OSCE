// Tests de la route /api/evaluator/evaluate — dual output (markdown + scores).

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

// Hoisted : vi.mock est remonté en haut du fichier, donc on doit exposer la mock fn
// et le store de config via vi.hoisted pour y faire référence dans les factories.
const { runEvaluationMock, configMocks } = vi.hoisted(() => {
  return {
    runEvaluationMock: vi.fn(),
    configMocks: { openai: "sk", anthropic: "sk-ant" },
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    messages = { create: vi.fn() };
    constructor(_opts: unknown) {}
  }
  return { default: Anthropic };
});

vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(async () => {}),
  getOpenAIKey: () => configMocks.openai,
  getAnthropicKey: () => configMocks.anthropic,
  setKeys: vi.fn(async () => {}),
  isConfigured: () => true,
}));

vi.mock("../services/evaluatorService", async () => {
  const actual = await vi.importActual<typeof import("../services/evaluatorService")>(
    "../services/evaluatorService",
  );
  return {
    ...actual,
    runEvaluation: runEvaluationMock,
  };
});

import { buildTestApp } from "./helpers";
import {
  EvaluatorOutputError,
  EvaluatorStationNotFoundError,
} from "../services/evaluatorService";

const VALID_RESULT = {
  markdown: "# Rapport\n\nContenu détaillé…",
  scores: {
    globalScore: 72,
    sections: [
      { key: "anamnese", name: "Anamnèse", weight: 0.25, score: 80, raw: "8/10" },
      { key: "examen", name: "Examen", weight: 0.25, score: 65 },
      { key: "management", name: "Management", weight: 0.5, score: 70 },
    ],
    verdict: "Réussi" as const,
  },
};

describe("POST /api/evaluator/evaluate", () => {
  beforeEach(() => { configMocks.anthropic = "sk-ant"; });
  afterEach(() => vi.clearAllMocks());

  it("returns { markdown, scores } on a valid result", async () => {
    runEvaluationMock.mockResolvedValue(VALID_RESULT);
    const app = buildTestApp();
    const res = await request(app).post("/api/evaluator/evaluate").send({
      stationId: "RESCOS-1",
      transcript: [
        { role: "doctor", text: "Bonjour" },
        { role: "patient", text: "J'ai mal" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(VALID_RESULT);
  });

  it("502 upstream_error when the service fails to parse the model output", async () => {
    runEvaluationMock.mockRejectedValue(
      new EvaluatorOutputError("Missing <scores_json>", "raw text"),
    );
    const app = buildTestApp();
    const res = await request(app).post("/api/evaluator/evaluate").send({
      stationId: "RESCOS-1",
      transcript: [{ role: "doctor", text: "hi" }],
    });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("upstream_error");
  });

  it("400 when station not found", async () => {
    runEvaluationMock.mockRejectedValue(new EvaluatorStationNotFoundError("XYZ-1"));
    const app = buildTestApp();
    const res = await request(app).post("/api/evaluator/evaluate").send({
      stationId: "XYZ-1",
      transcript: [{ role: "doctor", text: "hi" }],
    });
    expect(res.status).toBe(400);
  });

  it("412 when Anthropic key is missing", async () => {
    configMocks.anthropic = "";
    const app = buildTestApp();
    const res = await request(app).post("/api/evaluator/evaluate").send({
      stationId: "RESCOS-1",
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
