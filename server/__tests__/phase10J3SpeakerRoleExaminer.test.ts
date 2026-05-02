// Phase 10 J3 — dette 6 : alignement speakerRole sur speakerId quand
// conversationMode === "examiner".
//
// Couvre :
//   • Schéma : conversationSpeakerRoleSchema accepte les 4 valeurs
//     (patient/accompanying/witness/examiner) ; participantRoleSchema reste
//     strict à 3 valeurs (additif strict, contrat Phase 4 J1 préservé).
//   • runExaminerChat (POST /api/patient/chat) : speakerRole === "examiner"
//     (au lieu de "patient" placeholder pré-J3).
//   • streamExaminerChat (SSE /api/patient/chat/stream) : premier event
//     `speaker` avec speakerRole === "examiner".
//   • Non-régression : flow patient classique (RESCOS-1) retourne toujours
//     speakerRole === "patient".

import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";

// ─── Mocks OpenAI / config (cf. phase9J1ExaminerFlow.test.ts) ─────────────
const openaiChat = vi.fn();
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: openaiChat } };
    audio = {
      transcriptions: { create: vi.fn() },
      speech: { create: vi.fn() },
    };
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

vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(async () => {}),
  getOpenAIKey: () => "sk-test-J3-fake",
  getAnthropicKey: () => "sk-ant-test-J3-fake",
  setKeys: vi.fn(async () => {}),
  isConfigured: () => true,
}));

import {
  participantRoleSchema,
  conversationSpeakerRoleSchema,
} from "@shared/station-schema";
import { initCatalog } from "../services/stationsService";
import { runPatientChat, streamPatientChat } from "../services/patientService";

beforeAll(async () => {
  await initCatalog();
});

afterEach(() => vi.clearAllMocks());

// ────────────────────────────────────────────────────────────────────────
// 1. Schémas Zod : additif strict, ParticipantRole inchangé
// ────────────────────────────────────────────────────────────────────────

describe("Phase 10 J3 — schémas Zod (additif strict, contrat Phase 4 J1 préservé)", () => {
  it("participantRoleSchema reste strictement à 3 valeurs (patient/accompanying/witness)", () => {
    expect(participantRoleSchema.parse("patient")).toBe("patient");
    expect(participantRoleSchema.parse("accompanying")).toBe("accompanying");
    expect(participantRoleSchema.parse("witness")).toBe("witness");
    // "examiner" REJETÉ par participantRoleSchema (pas un profil de station).
    expect(() => participantRoleSchema.parse("examiner")).toThrow();
  });

  it("conversationSpeakerRoleSchema accepte les 4 valeurs (patient/accompanying/witness/examiner)", () => {
    expect(conversationSpeakerRoleSchema.parse("patient")).toBe("patient");
    expect(conversationSpeakerRoleSchema.parse("accompanying")).toBe("accompanying");
    expect(conversationSpeakerRoleSchema.parse("witness")).toBe("witness");
    expect(conversationSpeakerRoleSchema.parse("examiner")).toBe("examiner");
  });

  it("conversationSpeakerRoleSchema rejette les valeurs inconnues", () => {
    expect(() => conversationSpeakerRoleSchema.parse("doctor")).toThrow();
    expect(() => conversationSpeakerRoleSchema.parse("medecin")).toThrow();
    expect(() => conversationSpeakerRoleSchema.parse("")).toThrow();
  });

  it("ConversationSpeakerRole superset strict de ParticipantRole (additif Phase 10 J3)", () => {
    // Toute valeur de ParticipantRole doit être valide pour
    // ConversationSpeakerRole (rétrocompat).
    for (const role of ["patient", "accompanying", "witness"] as const) {
      expect(participantRoleSchema.parse(role)).toBe(role);
      expect(conversationSpeakerRoleSchema.parse(role)).toBe(role);
    }
    // "examiner" est exclusif à ConversationSpeakerRole.
    expect(conversationSpeakerRoleSchema.parse("examiner")).toBe("examiner");
    expect(() => participantRoleSchema.parse("examiner")).toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. runExaminerChat : speakerRole === "examiner" (alignement J3)
// ────────────────────────────────────────────────────────────────────────

describe("Phase 10 J3 — runExaminerChat (non-streaming) speakerRole alignement", () => {
  it("RESCOS-64-P2 + conversationMode='examiner' → speakerRole === 'examiner' (au lieu de 'patient' pré-J3)", async () => {
    openaiChat.mockResolvedValue({
      choices: [{ message: { content: "Pouvez-vous présenter brièvement la patiente ?" } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    const out = await runPatientChat({
      stationId: "RESCOS-64-P2",
      history: [],
      userMessage: "",
      mode: "voice",
      conversationMode: "examiner",
    });
    expect(out.type).toBe("reply");
    if (out.type !== "reply") return;
    expect(out.speakerId).toBe("examiner");
    expect(out.speakerRole).toBe("examiner");
  });

  it("RESCOS-64-P2 + conversationMode='examiner' + tour suivant (history non-vide) → speakerRole reste 'examiner'", async () => {
    openaiChat.mockResolvedValue({
      choices: [{ message: { content: "Quel est le motif principal de consultation ?" } }],
      usage: { prompt_tokens: 150, completion_tokens: 15 },
    });
    const out = await runPatientChat({
      stationId: "RESCOS-64-P2",
      history: [
        { role: "assistant", content: "Pouvez-vous présenter brièvement la patiente ?" },
        { role: "user", content: "Madame Dupont, 64 ans..." },
      ],
      userMessage: "Quel est le motif ?",
      mode: "text",
      conversationMode: "examiner",
    });
    expect(out.type).toBe("reply");
    if (out.type !== "reply") return;
    expect(out.speakerRole).toBe("examiner");
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. streamExaminerChat (SSE) : premier event `speaker` avec speakerRole 'examiner'
// ────────────────────────────────────────────────────────────────────────

async function* makeOpenAiStreamChunks(text: string) {
  // Émule la shape OpenAI streaming (choices[0].delta.content + usage final).
  for (const word of text.split(" ")) {
    yield { choices: [{ delta: { content: word + " " } }] };
  }
  yield { usage: { prompt_tokens: 50, completion_tokens: 10 } };
}

describe("Phase 10 J3 — streamExaminerChat (SSE) premier event `speaker`", () => {
  it("RESCOS-64-P2 + conversationMode='examiner' → premier event SSE = speaker avec speakerRole='examiner'", async () => {
    openaiChat.mockResolvedValue(makeOpenAiStreamChunks("Pouvez-vous présenter la patiente ?"));
    const events: any[] = [];
    for await (const evt of streamPatientChat({
      stationId: "RESCOS-64-P2",
      history: [],
      userMessage: "",
      mode: "voice",
      conversationMode: "examiner",
    })) {
      events.push(evt);
      if (events.length >= 5) break; // assez pour vérifier l'ouverture
    }
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe("speaker");
    expect(events[0].speakerId).toBe("examiner");
    expect(events[0].speakerRole).toBe("examiner");
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. Non-régression flow patient classique (mode="patient" implicite/explicite)
// ────────────────────────────────────────────────────────────────────────

describe("Phase 10 J3 — non-régression flow patient classique (speakerRole inchangé)", () => {
  it("RESCOS-1 (mono-patient classique) sans conversationMode → speakerRole === 'patient' (inchangé)", async () => {
    openaiChat.mockResolvedValue({
      choices: [{ message: { content: "Bonjour docteur." } }],
      usage: { prompt_tokens: 80, completion_tokens: 5 },
    });
    const out = await runPatientChat({
      stationId: "RESCOS-1",
      history: [],
      userMessage: "Bonjour, comment vous sentez-vous ?",
      mode: "voice",
    });
    expect(out.type).toBe("reply");
    if (out.type !== "reply") return;
    expect(out.speakerId).toBe("patient");
    expect(out.speakerRole).toBe("patient");
  });

  it("RESCOS-1 (classique) avec conversationMode='patient' explicite → speakerRole === 'patient' (rétrocompat)", async () => {
    openaiChat.mockResolvedValue({
      choices: [{ message: { content: "Oui docteur." } }],
      usage: { prompt_tokens: 80, completion_tokens: 5 },
    });
    const out = await runPatientChat({
      stationId: "RESCOS-1",
      history: [],
      userMessage: "Avez-vous mal ?",
      mode: "text",
      conversationMode: "patient",
    });
    expect(out.type).toBe("reply");
    if (out.type !== "reply") return;
    expect(out.speakerRole).toBe("patient");
  });
});
