// Tests des routes /api/patient/{chat,stt,tts}.

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
      name,
      type: opts.type ?? "audio/webm",
      buffer: buf,
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

const configMocks = {
  openai: "sk-test-openai" as string,
  anthropic: "sk-ant-test" as string,
};
vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(async () => {}),
  getOpenAIKey: () => configMocks.openai,
  getAnthropicKey: () => configMocks.anthropic,
  setKeys: vi.fn(async () => {}),
  isConfigured: () => true,
}));

import { buildTestApp } from "./helpers";

const SAMPLE_STATION = {
  scenario: "Douleur thoracique aiguë",
  context: "Fumeur, diabétique",
  vitals: { hr: "110", bp: "160/95", rr: "22", temp: "37.1", spo2: "94" },
  openingLine: "Docteur, j'ai mal à la poitrine.",
};

describe("POST /api/patient/chat", () => {
  beforeEach(() => {
    configMocks.openai = "sk-test-openai";
  });

  afterEach(() => vi.clearAllMocks());

  it("returns the assistant reply", async () => {
    openaiChat.mockResolvedValue({
      choices: [{ message: { content: "J'ai très mal au thorax." } }],
    });
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/chat").send({
      station: SAMPLE_STATION,
      history: [],
      userMessage: "Bonjour, qu'est-ce qui vous amène ?",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: "J'ai très mal au thorax." });
    expect(openaiChat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini",
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({ role: "user", content: "Bonjour, qu'est-ce qui vous amène ?" }),
        ]),
      }),
    );
  });

  it("400 on invalid body", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/chat").send({ station: {} });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });

  it("412 when OpenAI key is absent", async () => {
    configMocks.openai = "";
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/chat").send({
      station: SAMPLE_STATION,
      history: [],
      userMessage: "Bonjour",
    });
    expect(res.status).toBe(412);
    expect(res.body.code).toBe("not_configured");
  });

  it("429 when provider returns rate limit", async () => {
    openaiChat.mockRejectedValue(Object.assign(new Error("rate limit"), { status: 429 }));
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/chat").send({
      station: SAMPLE_STATION,
      history: [],
      userMessage: "Bonjour",
    });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("rate_limited");
  });
});

describe("POST /api/patient/stt", () => {
  beforeEach(() => {
    configMocks.openai = "sk-test-openai";
  });

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
    expect(openaiTranscribe).toHaveBeenCalledWith(
      expect.objectContaining({ model: "whisper-1", language: "fr" }),
    );
  });

  it("400 when no audio field", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/stt").send();
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });
});

describe("POST /api/patient/tts", () => {
  beforeEach(() => {
    configMocks.openai = "sk-test-openai";
  });

  afterEach(() => vi.clearAllMocks());

  it("streams mp3 bytes with audio/mpeg content-type", async () => {
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x64]);
    openaiSpeech.mockResolvedValue({
      arrayBuffer: async () => audio.buffer,
    });
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/patient/tts")
      .send({ text: "Bonjour.", voice: "nova" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/mpeg");
    expect(res.body).toBeInstanceOf(Buffer);
    expect(Array.from(res.body as Buffer)).toEqual(Array.from(audio));
  });

  it("rejects invalid voice with 400", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/tts").send({ text: "hi", voice: "bogus" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });
});
