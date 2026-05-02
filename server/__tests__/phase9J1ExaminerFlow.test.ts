// Phase 9 J1 — flow LLM examinateur RESCOS-64-P2 (Bug 3c E2E Phase 8).
//
// Couvre :
//   • Détection mode examinateur stricte par suffixe -P2$ : RESCOS-64-P2
//     bascule vers examiner.md, RESCOS-64 (partie 1) et toutes les autres
//     stations (mono-patient, multi-profils) restent sur patient.md /
//     caregiver.md (zéro régression sur 287 stations).
//   • Construction du system prompt examinateur :
//       — charge le template examiner.md
//       — injecte les 15 examinerQuestion p1-p15 dans l'ordre
//       — N'INJECTE PAS de bloc <station_data> (zéro narratif patient)
//       — N'INJECTE PAS les directives patient simulé (specialty, lay,
//         legalLeak, mode voix/texte)
//   • Endpoint POST /api/patient/chat : conversationMode "examiner" en
//     T0 avec userMessage="" produit une réponse 200 avec speakerId
//     "examiner". Mode "patient" (défaut) inchangé sur RESCOS-1 (non-rég).
//   • Schema Zod : conversationMode défaut "patient" (rétrocompat) ;
//     userMessage="" rejeté en mode patient (400) ; userMessage="" accepté
//     en mode examiner T0 (200) ; userMessage="" rejeté en mode examiner
//     avec history non-vide (400).
//   • Pipeline : bypass de resolveTargetParticipant en mode examiner
//     (mock ne reçoit pas de target — le flow examinateur n'utilise pas
//     addressRouter).
//   • Fixture Examinateur_RESCOS_4.json : les 15 examinerQuestion p1-p15
//     sont présentes et non vides.
//
// Contraintes : ZÉRO appel OpenAI réel — `openaiChat` est mocké.

import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";
import request from "supertest";

// ─── Mocks OpenAI / Anthropic / config (cf. patient.test.ts) ──────────────
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
  return {
    default: OpenAI,
    toFile: vi.fn(),
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

import { initCatalog } from "../services/stationsService";
import { buildSystemPrompt, buildExaminerSystemPrompt } from "../services/patientService";
import { buildTestApp } from "./helpers";
import { promises as fs } from "fs";
import path from "path";

beforeAll(async () => {
  await initCatalog();
});

afterEach(() => vi.clearAllMocks());

// ────────────────────────────────────────────────────────────────────────
// 1. Fixture Examinateur_RESCOS_4.json — examinerQuestion p1-p15 présentes
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J1 — fixture Examinateur_RESCOS_4 (15 examinerQuestion)", () => {
  it("RESCOS-64 partie 2 : 15 items presentation, chacun avec examinerQuestion non vide", async () => {
    const file = path.resolve(
      import.meta.dirname,
      "..",
      "data",
      "evaluator",
      "Examinateur_RESCOS_4.json",
    );
    const content = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(content) as {
      stations: Array<{ id: string; grille?: { presentation?: Array<{ id: string; examinerQuestion?: string }> } }>;
    };
    const station = parsed.stations.find(
      (s) => s.id === "RESCOS-64 - Toux - Station double 2",
    );
    expect(station).toBeDefined();
    const presentation = station!.grille?.presentation ?? [];
    expect(presentation.length).toBe(15);
    for (let i = 0; i < 15; i++) {
      const item = presentation[i];
      expect(item.id).toBe(`p${i + 1}`);
      expect(typeof item.examinerQuestion).toBe("string");
      expect((item.examinerQuestion ?? "").length).toBeGreaterThan(10);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. Détection mode examinateur — buildSystemPrompt dispatch
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J1 — dispatch buildSystemPrompt (-P2$ → examiner.md)", () => {
  it("RESCOS-64-P2 → prompt examinateur (template examiner.md détectable)", async () => {
    const prompt = await buildSystemPrompt("RESCOS-64-P2", "voice");
    // examiner.md commence par ce titre canonique.
    expect(prompt).toContain("ECOS Examinateur Standardisé");
    // Pas de directive patient simulé ("TU INCARNES" absent — propre au flow patient).
    expect(prompt).not.toContain("TU INCARNES");
    // Pas de bloc <station_data> (zéro narratif patient).
    expect(prompt).not.toContain("<station_data>");
  });

  it("RESCOS-64 (partie 1) → prompt patient simulé classique (non-régression)", async () => {
    const prompt = await buildSystemPrompt("RESCOS-64", "voice");
    expect(prompt).toContain("ECOS Patient Standardisé");
    expect(prompt).not.toContain("ECOS Examinateur Standardisé");
    expect(prompt).toContain("<station_data>");
  });

  it("RESCOS-1 → prompt patient simulé classique (témoin non-régression)", async () => {
    const prompt = await buildSystemPrompt("RESCOS-1", "voice");
    expect(prompt).toContain("ECOS Patient Standardisé");
    expect(prompt).not.toContain("ECOS Examinateur Standardisé");
  });

  it("AMBOSS-24 → prompt patient simulé classique (témoin non-régression Phase 7 legal)", async () => {
    const prompt = await buildSystemPrompt("AMBOSS-24", "voice");
    expect(prompt).toContain("ECOS Patient Standardisé");
    expect(prompt).not.toContain("ECOS Examinateur Standardisé");
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. Contenu du prompt examinateur (15 questions ordonnées + règles)
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J1 — contenu prompt examinateur (RESCOS-64-P2)", () => {
  it("contient les 15 questions p1-p15 numérotées dans l'ordre", async () => {
    const prompt = await buildExaminerSystemPrompt("RESCOS-64-P2");
    // Questions canoniques attendues (extraits significatifs).
    const expectedFragments = [
      "Pouvez-vous présenter brièvement la patiente",         // p1
      "motif principal de consultation",                       // p2
      "évolution de la toux et de la dyspnée",                 // p3
      "antécédents toxiques",                                  // p4
      "symptômes thoraciques associés",                        // p5
      "antécédents pulmonaires",                               // p6
      "signes généraux pertinents",                            // p7
      "signes d'infection",                                    // p8
      "signes vitaux respiratoires",                           // p9
      "auscultation pulmonaire",                               // p10
      "percussion pulmonaire",                                 // p11
      "auscultation cardiaque",                                // p12
      "palpation thoracique",                                  // p13
      "évaluation globale de la présentation",                 // p14
      "explorer davantage",                                    // p15
    ];
    let lastIndex = -1;
    for (let i = 0; i < expectedFragments.length; i++) {
      const idx = prompt.indexOf(expectedFragments[i]);
      expect(idx, `fragment p${i + 1} « ${expectedFragments[i]} » absent du prompt`).toBeGreaterThanOrEqual(0);
      // Vérifie l'ordre strict.
      expect(idx, `fragment p${i + 1} hors-ordre dans le prompt`).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
    // Les 15 sont numérotées « 1. … 15. ».
    for (let i = 1; i <= 15; i++) {
      expect(prompt).toMatch(new RegExp(`(^|\\n)${i}\\. `));
    }
  });

  it("contient les règles strictes neutralité (pas d'aide, pas de validation, pas de feedback)", async () => {
    const prompt = await buildExaminerSystemPrompt("RESCOS-64-P2");
    expect(prompt).toContain("Aucune aide");
    expect(prompt).toContain("Aucune validation");
    expect(prompt).toContain("Aucun feedback inline");
    expect(prompt).toContain("Neutralité tonale");
  });

  it("contient la conclusion canonique « Merci, l'évaluation est terminée. »", async () => {
    const prompt = await buildExaminerSystemPrompt("RESCOS-64-P2");
    expect(prompt).toContain("Merci, l'évaluation est terminée.");
  });

  it("ne contient pas de narratif patient privé (Mme Dumont contextuel OK, mais pas anamnèse)", async () => {
    const prompt = await buildExaminerSystemPrompt("RESCOS-64-P2");
    // Pas de bloc station_data JSON.
    expect(prompt).not.toContain("<station_data>");
    // Pas d'éléments narratifs propres au patient (champs typiques fixture patient).
    expect(prompt).not.toContain("histoire_actuelle");
    expect(prompt).not.toContain("habitudes");
    expect(prompt).not.toContain("antecedents");
    // Pas d'instruction d'incarnation patient.
    expect(prompt).not.toContain("TU INCARNES");
    // Pas d'instructions liées au flow patient simulé.
    expect(prompt).not.toContain("phrase_ouverture");
  });

  it("instruction d'ouverture LLM-initiated explicite (le LLM commence)", async () => {
    const prompt = await buildExaminerSystemPrompt("RESCOS-64-P2");
    // Le prompt doit indiquer clairement que c'est l'examinateur qui ouvre.
    expect(prompt).toMatch(/c'est TOI qui ouvres/i);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. Endpoint POST /api/patient/chat — conversationMode "examiner"
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J1 — POST /api/patient/chat (conversationMode examiner)", () => {
  it("RESCOS-64-P2 + conversationMode=examiner + userMessage='' + history vide → 200, speakerId=examiner", async () => {
    openaiChat.mockResolvedValue({
      choices: [{ message: { content: "Pouvez-vous présenter brièvement la patiente ?" } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/chat").send({
      stationId: "RESCOS-64-P2",
      history: [],
      userMessage: "",
      mode: "voice",
      conversationMode: "examiner",
    });
    expect(res.status).toBe(200);
    // Phase 10 J3 dette 6 : speakerRole "patient" → "examiner" (alignement
    // sémantique speakerId/speakerRole, type ConversationSpeakerRole). Avant
    // J3 : placeholder ParticipantRole pour compat type ; depuis J3 : type
    // élargi à 4 valeurs incluant "examiner".
    expect(res.body).toEqual({
      type: "reply",
      reply: "Pouvez-vous présenter brièvement la patiente ?",
      speakerId: "examiner",
      speakerRole: "examiner",
    });
    // Vérifie que le LLM a été appelé sans message user à T0 (system seul).
    expect(openaiChat).toHaveBeenCalledOnce();
    const call = openaiChat.mock.calls[0][0];
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[0].content).toContain("ECOS Examinateur Standardisé");
  });

  it("RESCOS-64-P2 + conversationMode=examiner + userMessage non-vide + history non-vide → 200, message user injecté", async () => {
    openaiChat.mockResolvedValue({
      choices: [{ message: { content: "Quel est le motif principal de consultation ?" } }],
      usage: { prompt_tokens: 150, completion_tokens: 15 },
    });
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/chat").send({
      stationId: "RESCOS-64-P2",
      history: [
        { role: "assistant", content: "Pouvez-vous présenter brièvement la patiente ?" },
        { role: "user", content: "Madame Dumont, 65 ans." },
      ],
      userMessage: "Madame Dumont, 65 ans, ouvrière retraitée.",
      mode: "voice",
      conversationMode: "examiner",
    });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("reply");
    expect(res.body.speakerId).toBe("examiner");
    const call = openaiChat.mock.calls[0][0];
    // System + 2 history + user = 4 messages.
    expect(call.messages).toHaveLength(4);
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[3].role).toBe("user");
    expect(call.messages[3].content).toContain("Madame Dumont");
  });

  it("RESCOS-1 + conversationMode défaut (omis) → flow patient simulé (non-régression)", async () => {
    openaiChat.mockResolvedValue({
      choices: [{ message: { content: "J'ai mal au thorax." } }],
      usage: { prompt_tokens: 200, completion_tokens: 10 },
    });
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/chat").send({
      stationId: "RESCOS-1",
      history: [],
      userMessage: "Bonjour, qu'est-ce qui vous amène ?",
      mode: "voice",
      // conversationMode OMIS → défaut "patient"
    });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("reply");
    // Mode patient classique : speakerId !== "examiner".
    expect(res.body.speakerId).not.toBe("examiner");
    // System prompt envoyé doit être patient.md (pas examiner.md).
    const call = openaiChat.mock.calls[0][0];
    expect(call.messages[0].content).toContain("ECOS Patient Standardisé");
    expect(call.messages[0].content).not.toContain("ECOS Examinateur Standardisé");
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. Validation Zod — superRefine userMessage selon mode
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J1 — validation Zod conversationMode + userMessage", () => {
  it("conversationMode=patient + userMessage='' → 400 (contrat historique préservé)", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/chat").send({
      stationId: "RESCOS-1",
      history: [],
      userMessage: "",
      mode: "voice",
      conversationMode: "patient",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });

  it("conversationMode=examiner + userMessage='' + history non-vide → 400 (T0 seulement)", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/chat").send({
      stationId: "RESCOS-64-P2",
      history: [
        { role: "assistant", content: "Question 1." },
        { role: "user", content: "Réponse 1." },
      ],
      userMessage: "",
      mode: "voice",
      conversationMode: "examiner",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });

  it("conversationMode=examiner + userMessage='' + history vide → accepté (T0 examinateur)", async () => {
    openaiChat.mockResolvedValue({
      choices: [{ message: { content: "Question 1." } }],
      usage: { prompt_tokens: 50, completion_tokens: 5 },
    });
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/chat").send({
      stationId: "RESCOS-64-P2",
      history: [],
      userMessage: "",
      mode: "voice",
      conversationMode: "examiner",
    });
    expect(res.status).toBe(200);
  });

  it("conversationMode invalide (« unknown ») → 400 enum validation", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/patient/chat").send({
      stationId: "RESCOS-1",
      history: [],
      userMessage: "Bonjour.",
      mode: "voice",
      conversationMode: "unknown",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });
});
