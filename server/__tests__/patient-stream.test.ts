// Tests du endpoint SSE /api/patient/chat/stream (route).
// Focus : format SSE, ordre d'events, gestion des erreurs. Le generator sous-jacent
// est mocké ici — les tests du generator lui-même vivent dans patient-stream-service.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const openaiChatCreate = vi.fn();
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: openaiChatCreate } };
    audio = { transcriptions: { create: vi.fn() }, speech: { create: vi.fn() } };
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

const configMocks = { openai: "sk-test-openai" };
vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(async () => {}),
  getOpenAIKey: () => configMocks.openai,
  getAnthropicKey: () => "",
  setKeys: vi.fn(async () => {}),
  isConfigured: () => true,
}));

const streamStub = vi.fn();
vi.mock("../services/patientService", async () => {
  const actual = await vi.importActual<typeof import("../services/patientService")>(
    "../services/patientService",
  );
  return {
    ...actual,
    streamPatientChat: (...args: any[]) => streamStub(...args),
    getPatientBrief: vi.fn(async () => ({
      stationId: "RESCOS-1",
      setting: "",
      patientDescription: "",
      vitals: {},
      phraseOuverture: "",
    })),
  };
});

import { buildTestApp } from "./helpers";

function parseEvents(body: string) {
  return body
    .split("\n\n")
    .filter((b) => b.trim().length > 0)
    .map((block) => {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      let data: any = null;
      try { data = JSON.parse(dataLines.join("\n")); } catch {}
      return { event, data };
    });
}

describe("POST /api/patient/chat/stream", () => {
  beforeEach(() => { configMocks.openai = "sk-test-openai"; });
  afterEach(() => vi.clearAllMocks());

  it("emits SSE events in order and sets text/event-stream content type", async () => {
    streamStub.mockImplementation(() => (async function* () {
      yield { type: "delta", text: "Bonjour " };
      yield { type: "delta", text: "docteur." };
      yield { type: "sentence", text: "Bonjour docteur.", index: 0 };
      yield { type: "done", fullText: "Bonjour docteur." };
    })());

    const app = buildTestApp();
    const res = await request(app)
      .post("/api/patient/chat/stream")
      .send({ stationId: "RESCOS-1", history: [], userMessage: "Bonjour", mode: "text" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");

    const events = parseEvents(res.text);
    expect(events.map((e) => e.event)).toEqual(["delta", "delta", "sentence", "done"]);
    expect(events[2].data).toEqual({ text: "Bonjour docteur.", index: 0 });
    expect(events[3].data).toEqual({ fullText: "Bonjour docteur." });
  });

  it("returns 400 on invalid payload (no stream started)", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/patient/chat/stream")
      .send({ stationId: "" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });

  it("returns 412 when OpenAI key is missing", async () => {
    configMocks.openai = "";
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/patient/chat/stream")
      .send({ stationId: "RESCOS-1", history: [], userMessage: "Bonjour", mode: "text" });
    expect(res.status).toBe(412);
    expect(res.body.code).toBe("not_configured");
  });

  it("emits event: error when upstream fails mid-stream", async () => {
    streamStub.mockImplementation(() => (async function* () {
      yield { type: "delta", text: "Bonjour " };
      const err: any = new Error("upstream timeout");
      err.status = 502;
      throw err;
    })());

    const app = buildTestApp();
    const res = await request(app)
      .post("/api/patient/chat/stream")
      .send({ stationId: "RESCOS-1", history: [], userMessage: "Hi", mode: "text" });

    expect(res.status).toBe(200);
    const events = parseEvents(res.text);
    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.code).toBe("upstream_error");
  });
});
