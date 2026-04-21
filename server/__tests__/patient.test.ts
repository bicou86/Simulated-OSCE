// Tests des routes /api/patient/{chat,stt,tts,:id/brief}.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const openaiChat = vi.fn();
const openaiTranscribe = vi.fn();
const openaiSpeech = vi.fn();

vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: openaiChat } };
    audio = {
      transcriptions: { create: openaiTranscribe },
      speech: { create: openaiSpeech },
    };
    models = { list: vi.fn() };
    constructor(_opts: unknown) {}
  }
  return {
    default: OpenAI,
    toFile: vi.fn(async (buf: Buffer, name: string, opts: { type?: string } = {}) => ({
      name, type: opts.type ?? "audio/webm", buffer: buf,
    })),
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    messages = { create: vi.fn() };
    constructor(_opts: unknown) {}
  }
  return { default: Anthropic };
});

const configMocks = { openai: "sk-test-openai", anthropic: "sk-ant-test" };
vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(async () => {}),
  getOpenAIKey: () => configMocks.openai,
  getAnthropicKey: () => configMocks.anthropic,
  setKeys: vi.fn(async () => {}),
  isConfigured: () => true,
}));

// Mock du service patient : pas besoin de lire les vrais JSON dans les tests.
const buildSystemPromptMock = vi.fn();
vi.mock("../services/patientService", async () => {
  const actual = await vi.importActual<typeof import("../services/patientService")>(
    "../services/patientService",
  );
  return {
    ...actual,
    runPatientChat: vi.fn(async (opts: { userMessage: string }) => {
      await buildSystemPromptMock(opts);
      // la fonction réelle appelle OpenAI — on re-bind à notre mock de chat pour vérifier
      // que les routes construisent bien le payload attendu.
      const completion = await openaiChat({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "mocked-system-prompt" },
          { role: "user", content: opts.userMessage },
        ],
      });
      return completion.choices[0]?.message?.content?.trim() ?? "";
    }),
    getPatientBrief: vi.fn(async (stationId: string) => ({
      stationId,
      setting: "Cabinet test",
      patientDescription: "Patient test",
      vitals: { ta: "120/80" },
      phraseOuverture: "Bonjour docteur.",
    })),
  };
});

import { buildTestApp } from "./helpers";

describe("POST /api/patient/chat", () => {
  beforeEach(() => { configMocks.openai = "sk-test-openai"; });
  afterEach(() => vi.clearAllMocks());

  it("returns the assistant reply from the service", async () => {
    openaiChat.mockResolvedValue({
      choices: [{ message: { content: "J'ai mal au thorax." } }],
    });
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/chat").send({
      stationId: "RESCOS-1",
      history: [],
      userMessage: "Bonjour, qu'est-ce qui vous amène ?",
      mode: "voice",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: "J'ai mal au thorax." });
  });

  it("400 on invalid body", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/chat").send({ stationId: "" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });

  it("412 when OpenAI key is absent", async () => {
    configMocks.openai = "";
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/chat").send({
      stationId: "RESCOS-1",
      history: [],
      userMessage: "Bonjour",
      mode: "text",
    });
    expect(res.status).toBe(412);
    expect(res.body.code).toBe("not_configured");
  });
});

describe("GET /api/patient/:id/brief", () => {
  it("returns the feuille-de-porte payload", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-1/brief");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      stationId: "RESCOS-1",
      setting: "Cabinet test",
      patientDescription: "Patient test",
      vitals: { ta: "120/80" },
      phraseOuverture: "Bonjour docteur.",
    });
  });
});

describe("POST /api/patient/stt", () => {
  beforeEach(() => { configMocks.openai = "sk-test-openai"; });
  afterEach(() => vi.clearAllMocks());

  it("returns { text } from the transcription", async () => {
    openaiTranscribe.mockResolvedValue({ text: "bonjour docteur" });
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/patient/stt")
      .attach("audio", Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), {
        filename: "clip.webm",
        contentType: "audio/webm",
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: "bonjour docteur" });
  });

  it("400 when no audio field", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/stt").send();
    expect(res.status).toBe(400);
  });
});

describe("POST /api/patient/tts", () => {
  beforeEach(() => { configMocks.openai = "sk-test-openai"; });
  afterEach(() => vi.clearAllMocks());

  it("streams mp3 bytes and sanitizes emojis before sending to OpenAI", async () => {
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x64]);
    openaiSpeech.mockResolvedValue({ arrayBuffer: async () => audio.buffer });
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/tts").send({
      text: "⏱️ Il vous reste 2 minutes ✅",
      voice: "nova",
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/mpeg");
    const payload = openaiSpeech.mock.calls[0]?.[0] as { input: string };
    expect(payload.input).toBe("Il vous reste 2 minutes");
  });

  it("400 when voice is invalid", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/tts").send({ text: "hi", voice: "bogus" });
    expect(res.status).toBe(400);
  });
});
