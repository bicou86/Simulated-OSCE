// Unit test : vérifie que streamPatientChat découpe correctement les phrases
// sur ponctuation terminale et flushe le reliquat en fin de flux.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Stoppe le chargement FS : prompts + stations.
vi.mock("../lib/prompts", () => ({
  loadPrompt: vi.fn(async () => "mocked-system-prompt"),
}));
vi.mock("../services/stationsService", () => ({
  getStationMeta: vi.fn(() => ({
    fullId: "RESCOS-1",
    patientFile: "x",
    evaluatorFile: "y",
    indexInFile: 0,
  })),
  patientFilePath: vi.fn((f: string) => `/tmp/${f}`),
  evaluatorFilePath: vi.fn((f: string) => `/tmp/${f}`),
  initCatalog: vi.fn(async () => {}),
}));

// Court-circuite l'accès FS dans getPatientStation en interceptant fs.readFile.
vi.mock("fs", async () => {
  const actual = await vi.importActual<any>("fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(async () =>
        JSON.stringify({ stations: [{ id: "RESCOS-1", setting: "stub" }] }),
      ),
    },
  };
});

function makeOpenAIStream(deltas: string[]) {
  return (async function* () {
    for (const text of deltas) {
      yield { choices: [{ delta: { content: text } }] };
    }
  })();
}

import { streamPatientChat } from "../services/patientService";

describe("streamPatientChat (generator)", () => {
  beforeEach(() => { configMocks.openai = "sk-test-openai"; });
  afterEach(() => vi.clearAllMocks());

  it("yields delta events and flushes sentences on terminal punctuation", async () => {
    openaiChatCreate.mockResolvedValue(
      makeOpenAIStream([
        "J'ai mal au thorax ",
        "depuis ce matin. ",
        "La douleur irradie ",
        "dans le bras gauche. ",
        "Je suis très inquiet",
      ]),
    );

    const events: any[] = [];
    for await (const evt of streamPatientChat({
      stationId: "RESCOS-1",
      history: [],
      userMessage: "Bonjour",
      mode: "text",
    })) {
      events.push(evt);
    }

    const types = events.map((e) => e.type);
    // Phase 4 J2 — le générateur émet d'abord un event `speaker` (id du
    // participant qui répond) avant tout delta. Les stations mono-patient
    // legacy émettent ce tag sur le participant unique synthétisé.
    expect(types[0]).toBe("speaker");
    expect(types[1]).toBe("delta");
    expect(types.at(-1)).toBe("done");
    const speakerEvt = events[0];
    expect(speakerEvt.speakerId).toBe("patient");
    expect(speakerEvt.speakerRole).toBe("patient");

    const sentences = events.filter((e) => e.type === "sentence");
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    sentences.forEach((s, i) => expect(s.index).toBe(i));

    const done = events.at(-1)!;
    expect(done.fullText).toContain("J'ai mal au thorax");
    expect(done.fullText).toContain("Je suis très inquiet");
    // Le tail sans ponctuation finale doit être flushé comme dernière sentence.
    expect(sentences.at(-1)!.text).toContain("Je suis très inquiet");
  });
});
