// Vérifie que buildSystemPrompt injecte la section "CONTEXTE D'INTERLOCUTION" correcte
// selon le cas détecté (adulte self / enfant pré-verbal parent / enfant scolaire parentPresent).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("openai", () => {
  class OpenAI { chat = { completions: { create: vi.fn() } }; audio = {}; models = { list: vi.fn() }; constructor(_: unknown) {} }
  return { default: OpenAI, toFile: vi.fn() };
});

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic { messages = { create: vi.fn() }; constructor(_: unknown) {} }
  return { default: Anthropic };
});

vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(async () => {}),
  getOpenAIKey: () => "sk-test",
  getAnthropicKey: () => "",
  setKeys: vi.fn(async () => {}),
  isConfigured: () => true,
}));

// Mock prompt loader + stationsService + fs pour éviter tout I/O.
vi.mock("../lib/prompts", () => ({
  loadPrompt: vi.fn(async () => "# Prompt patient de test\n\nTu es patient standardisé."),
}));
// Un patientFile par id → cache patient.ts ne confond pas les stations des différents tests.
vi.mock("../services/stationsService", () => ({
  getStationMeta: vi.fn((id: string) => ({
    fullId: id, patientFile: `${id}.json`, evaluatorFile: `${id}-eval.json`, indexInFile: 0,
  })),
  patientFilePath: vi.fn((f: string) => `/tmp/${f}`),
  evaluatorFilePath: vi.fn((f: string) => `/tmp/${f}`),
  initCatalog: vi.fn(async () => {}),
}));

// Chaque test remplace le contenu du "fichier" chargé par getPatientStation.
let currentStation: any = null;
vi.mock("fs", async () => {
  const actual = await vi.importActual<any>("fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(async () => JSON.stringify({ stations: [currentStation] })),
    },
  };
});

import { buildSystemPrompt } from "../services/patientService";

describe("buildSystemPrompt — interlocutor injection", () => {
  beforeEach(() => {
    // clear internal fileCache en rechargant un ID différent à chaque test ;
    // tricheur mais suffisant pour ces tests.
  });

  it("adult self → no CONTEXTE D'INTERLOCUTION section", async () => {
    currentStation = {
      id: "ADULT-SELF",
      patient_description: "Marcia Billings, femme de 47 ans, consultante pour des douleurs abdominales",
      age: "47 ans",
    };
    const prompt = await buildSystemPrompt("ADULT-SELF", "voice");
    expect(prompt).not.toContain("CONTEXTE D'INTERLOCUTION");
    expect(prompt).toContain("<station_data>");
  });

  it("infant 'présentée par sa mère' → parent/mother injected", async () => {
    currentStation = {
      id: "PEDIATRIC-PARENT",
      nom: "Virginia Jameson",
      patient_description: "Virginia Jameson, fillette de 2 ans, présentée par sa mère pour toux et fièvre",
      age: "2 ans",
    };
    const prompt = await buildSystemPrompt("PEDIATRIC-PARENT", "voice");
    expect(prompt).toContain("CONTEXTE D'INTERLOCUTION");
    expect(prompt).toContain("la mère");
    expect(prompt).toContain("Tu n'incarnes PAS le patient");
    expect(prompt).toContain("Virginia Jameson");
  });

  it("school-age child (6 ans, garçon) → self with parentPresent light directive", async () => {
    currentStation = {
      id: "SCHOOL-CHILD",
      nom: "Leo Morris",
      patient_description: "Leo Morris, garçon de 6 ans, avec mal de ventre",
      age: "6 ans",
    };
    const prompt = await buildSystemPrompt("SCHOOL-CHILD", "voice");
    expect(prompt).toContain("CONTEXTE D'INTERLOCUTION");
    expect(prompt).toContain("parent est présent");
    expect(prompt).toContain("tu es le patient");
  });

  it("text mode directive is still appended alongside interlocutor", async () => {
    currentStation = {
      id: "TEXT-MODE",
      patient_description: "Femme de 50 ans",
      age: "50 ans",
    };
    const prompt = await buildSystemPrompt("TEXT-MODE", "text");
    expect(prompt).toContain("## ADAPTATION");
    expect(prompt).toContain("mode texte");
  });
});
