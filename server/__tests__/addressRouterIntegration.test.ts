// Phase 4 J2 (fix runtime) — tests d'intégration du pipeline patient
// avec le routeur d'adresse.
//
// Ce fichier vérifie que :
//   • runPatientChat / streamPatientChat consultent routeAddress avant tout
//     appel OpenAI ;
//   • le bon system prompt (patient.md vs caregiver.md) est envoyé selon le
//     ROLE du target (et non plus seulement l'interlocuteur statique) ;
//   • un cas ambigu N'APPELLE PAS le LLM et retourne / yield un payload
//     `clarification_needed` ;
//   • les stations mono-patient legacy continuent de fonctionner sans
//     régression (PATIENT label par défaut, OpenAI appelé une fois par tour).
//
// Mocks : prompts loader (templates discriminants), stationsService (meta
// factice), fs (station JSON injectée par test), OpenAI (chat + stream).

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks externes ────────────────────────────────────────────────────────

const openaiChat = vi.fn();
const openaiChatStream = vi.fn();

vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: openaiChat } };
    audio = { transcriptions: { create: vi.fn() }, speech: { create: vi.fn() } };
    models = { list: vi.fn() };
    constructor(_: unknown) {}
  }
  return { default: OpenAI, toFile: vi.fn() };
});

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    messages = { create: vi.fn() };
    constructor(_: unknown) {}
  }
  return { default: Anthropic };
});

vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(async () => {}),
  getOpenAIKey: () => "sk-test",
  getAnthropicKey: () => "",
  setKeys: vi.fn(async () => {}),
  isConfigured: () => true,
}));

vi.mock("../lib/prompts", () => ({
  loadPrompt: vi.fn(async (name: string) => {
    if (name === "caregiver") {
      return "# CAREGIVER TEMPLATE\n\nTu es l'accompagnant·e.";
    }
    return "# PATIENT TEMPLATE\n\nTu es patient standardisé.";
  }),
}));

vi.mock("../services/stationsService", () => ({
  getStationMeta: vi.fn((id: string) => ({
    fullId: id,
    patientFile: `${id}.json`,
    evaluatorFile: `${id}-eval.json`,
    indexInFile: 0,
    stationType: "anamnese_examen",
  })),
  patientFilePath: vi.fn((f: string) => `/tmp/${f}`),
  evaluatorFilePath: vi.fn((f: string) => `/tmp/${f}`),
  initCatalog: vi.fn(async () => {}),
}));

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

import { runPatientChat, streamPatientChat } from "../services/patientService";

// ─── Fixtures station ──────────────────────────────────────────────────────

const RESCOS_70_LIKE = {
  id: "RESCOS-70-T",
  nom: "Emma Delacroix",
  age: "16 ans",
  patient_description:
    "Emma Delacroix, adolescente de 16 ans, consulte pour fatigue. Sa mère a pris le rendez-vous et reste présente en salle d'attente.",
  participants: [
    {
      id: "emma",
      role: "patient",
      name: "Emma Delacroix",
      age: 16,
      vocabulary: "lay",
      knowledgeScope: ["self.symptoms", "self.daily-life"],
    },
    {
      id: "mother",
      role: "accompanying",
      name: "Mère d'Emma Delacroix",
      vocabulary: "lay",
      knowledgeScope: ["family.history", "child.development"],
    },
  ],
};

const RESCOS_71_LIKE = {
  id: "RESCOS-71-T",
  nom: "M. Louis Bettaz",
  age: "78 ans",
  patient_description:
    "M. Louis Bettaz, 78 ans, cancer pancréatique métastatique. Représenté par sa fille Martine, 52 ans, accompagnante principale.",
  participants: [
    {
      id: "louis",
      role: "patient",
      name: "M. Louis Bettaz",
      age: 78,
      vocabulary: "lay",
      knowledgeScope: ["self.symptoms.partial"],
    },
    {
      id: "martine",
      role: "accompanying",
      name: "Martine Bettaz",
      age: 52,
      vocabulary: "lay",
      knowledgeScope: ["caregiver.observations", "treatment.adherence"],
    },
  ],
};

const MONO_PATIENT_LEGACY = {
  id: "MONO-1",
  nom: "Jean Dupont",
  age: "45 ans",
  patient_description: "Jean Dupont, homme de 45 ans, douleur thoracique.",
  // Pas de participants[] ⇒ station legacy.
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function mockOpenAIReply(text: string) {
  openaiChat.mockResolvedValue({
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
}

async function* makeOpenAiStream(text: string) {
  yield {
    choices: [{ delta: { content: text } }],
  };
  yield { usage: { prompt_tokens: 10, completion_tokens: 5 } } as any;
}

function getSystemMessageOf(call: ReturnType<typeof openaiChat.mock.calls.at> | any[]): string {
  const args = call?.[0] ?? {};
  const msgs: Array<{ role: string; content: string }> = args.messages ?? [];
  const sys = msgs.find((m) => m.role === "system");
  return sys?.content ?? "";
}

beforeEach(() => {
  openaiChat.mockReset();
  openaiChatStream.mockReset();
});

// ─── 1. Vocatif explicite Emma → patient template + speakerId=emma ────────

describe("runPatientChat (multi-profile) — RESCOS-70-like", () => {
  it("vocative 'Emma, …' routes to emma + uses PATIENT template + tags speakerId", async () => {
    currentStation = RESCOS_70_LIKE;
    mockOpenAIReply("Bonjour docteur, je me sens fatiguée.");

    const outcome = await runPatientChat({
      stationId: "RESCOS-70-T",
      history: [],
      userMessage: "Emma, peux-tu me dire ce qui t'amène aujourd'hui ?",
      mode: "text",
      currentSpeakerId: null,
    });

    expect(outcome.type).toBe("reply");
    if (outcome.type !== "reply") return;
    expect(outcome.speakerId).toBe("emma");
    expect(outcome.speakerRole).toBe("patient");
    expect(outcome.reply).toBe("Bonjour docteur, je me sens fatiguée.");

    const sys = getSystemMessageOf(openaiChat.mock.calls.at(0));
    expect(sys).toContain("PATIENT TEMPLATE");
    expect(sys).not.toContain("CAREGIVER TEMPLATE");
    expect(sys).toContain("Emma Delacroix");
    expect(sys).toContain("AUTRES PERSONNES PRÉSENTES");
    expect(sys).toContain("Mère d'Emma Delacroix");
  });

  it("'Et vous Madame, …' routes to mother + uses CAREGIVER template + tags accompanying", async () => {
    currentStation = RESCOS_70_LIKE;
    mockOpenAIReply("Elle est de plus en plus fatiguée depuis 3 semaines.");

    const outcome = await runPatientChat({
      stationId: "RESCOS-70-T",
      history: [],
      userMessage:
        "Et vous Madame, qu'avez-vous remarqué chez votre fille ces dernières semaines ?",
      mode: "text",
      currentSpeakerId: "emma",
    });

    expect(outcome.type).toBe("reply");
    if (outcome.type !== "reply") return;
    expect(outcome.speakerId).toBe("mother");
    expect(outcome.speakerRole).toBe("accompanying");

    const sys = getSystemMessageOf(openaiChat.mock.calls.at(0));
    expect(sys).toContain("CAREGIVER TEMPLATE");
    expect(sys).not.toContain("PATIENT TEMPLATE\n\nTu es patient standardisé");
    expect(sys).toContain("Mère d'Emma Delacroix");
  });

  it("explicit tag '[À Maman] …' overrides body 'Madame Delacroix' → mother", async () => {
    currentStation = RESCOS_70_LIKE;
    mockOpenAIReply("Oui, Emma a eu ses règles le mois dernier, je crois.");

    const outcome = await runPatientChat({
      stationId: "RESCOS-70-T",
      history: [],
      userMessage:
        "[À Maman] Madame Delacroix, votre fille a-t-elle eu ses règles récemment ?",
      mode: "text",
      currentSpeakerId: "emma",
    });

    expect(outcome.type).toBe("reply");
    if (outcome.type !== "reply") return;
    expect(outcome.speakerId).toBe("mother");
    expect(outcome.speakerRole).toBe("accompanying");
  });

  it("sticky: user keeps talking without marker → previous speaker (mother) responds", async () => {
    currentStation = RESCOS_70_LIKE;
    mockOpenAIReply("Elle dort moins bien, oui, elle se réveille la nuit.");

    const outcome = await runPatientChat({
      stationId: "RESCOS-70-T",
      history: [],
      userMessage: "Et au niveau du sommeil, quelque chose qui a changé ?",
      mode: "text",
      currentSpeakerId: "mother",
    });

    expect(outcome.type).toBe("reply");
    if (outcome.type !== "reply") return;
    expect(outcome.speakerId).toBe("mother");
  });

  it("ambiguous T0 (no marker, no currentSpeaker) → clarification, NO LLM call", async () => {
    currentStation = RESCOS_70_LIKE;
    mockOpenAIReply("ne devrait pas être appelé");

    const outcome = await runPatientChat({
      stationId: "RESCOS-70-T",
      history: [],
      userMessage: "Bonjour, je suis le Dr Martin et je vais vous examiner.",
      mode: "text",
      currentSpeakerId: null,
    });

    expect(outcome.type).toBe("clarification_needed");
    if (outcome.type !== "clarification_needed") return;
    expect(outcome.candidates).toHaveLength(2);
    const ids = outcome.candidates.map((c) => c.id).sort();
    expect(ids).toEqual(["emma", "mother"]);

    expect(openaiChat).not.toHaveBeenCalled();
  });
});

// ─── 2. Mono-patient legacy : aucune régression ───────────────────────────

describe("runPatientChat (mono-patient legacy) — rétrocompat 100 %", () => {
  it("station sans participants[] → speakerId='patient', PATIENT template, OpenAI appelé", async () => {
    currentStation = MONO_PATIENT_LEGACY;
    mockOpenAIReply("J'ai mal au thorax depuis ce matin.");

    const outcome = await runPatientChat({
      stationId: "MONO-1",
      history: [],
      userMessage: "Bonjour, qu'est-ce qui vous amène ?",
      mode: "text",
    });

    expect(outcome.type).toBe("reply");
    if (outcome.type !== "reply") return;
    expect(outcome.speakerId).toBe("patient");
    expect(outcome.speakerRole).toBe("patient");
    expect(openaiChat).toHaveBeenCalledTimes(1);

    const sys = getSystemMessageOf(openaiChat.mock.calls.at(0));
    expect(sys).toContain("PATIENT TEMPLATE");
    // Pas de bloc multi-profils sur les stations mono.
    expect(sys).not.toContain("AUTRES PERSONNES PRÉSENTES");
  });

  it("station mono-patient + 'Bonjour Madame Bidule' → toujours le patient unique (high)", async () => {
    currentStation = MONO_PATIENT_LEGACY;
    mockOpenAIReply("Bonjour docteur.");

    const outcome = await runPatientChat({
      stationId: "MONO-1",
      history: [],
      userMessage: "Bonjour Madame Bidule, comment allez-vous ?",
      mode: "text",
      currentSpeakerId: null,
    });

    expect(outcome.type).toBe("reply");
    if (outcome.type !== "reply") return;
    expect(outcome.speakerId).toBe("patient");
  });
});

// ─── 3. RESCOS-71 : Monsieur Bettaz vs Martine ────────────────────────────

describe("runPatientChat — RESCOS-71-like (caregiver speaks by default)", () => {
  it("'Monsieur Bettaz, vous avez mal ?' → louis (patient)", async () => {
    currentStation = RESCOS_71_LIKE;
    mockOpenAIReply("Oui, j'ai mal au ventre depuis ce matin.");

    const outcome = await runPatientChat({
      stationId: "RESCOS-71-T",
      history: [],
      userMessage: "Monsieur Bettaz, vous avez mal en ce moment ?",
      mode: "text",
      currentSpeakerId: "martine",
    });

    expect(outcome.type).toBe("reply");
    if (outcome.type !== "reply") return;
    expect(outcome.speakerId).toBe("louis");
    expect(outcome.speakerRole).toBe("patient");

    const sys = getSystemMessageOf(openaiChat.mock.calls.at(0));
    expect(sys).toContain("PATIENT TEMPLATE");
    expect(sys).toContain("Louis Bettaz");
  });

  it("sticky on Martine when no marker", async () => {
    currentStation = RESCOS_71_LIKE;
    mockOpenAIReply("Il dort de plus en plus la journée.");

    const outcome = await runPatientChat({
      stationId: "RESCOS-71-T",
      history: [],
      userMessage: "Pouvez-vous me décrire son état général aujourd'hui ?",
      mode: "text",
      currentSpeakerId: "martine",
    });

    expect(outcome.type).toBe("reply");
    if (outcome.type !== "reply") return;
    expect(outcome.speakerId).toBe("martine");
    expect(outcome.speakerRole).toBe("accompanying");
  });
});

// ─── 4. Stream version : speaker event → deltas → done ────────────────────

describe("streamPatientChat (multi-profile)", () => {
  it("yields `speaker` event before any delta when target resolved", async () => {
    currentStation = RESCOS_70_LIKE;
    openaiChat.mockResolvedValue(makeOpenAiStream("Bonjour docteur."));

    const events: any[] = [];
    for await (const evt of streamPatientChat({
      stationId: "RESCOS-70-T",
      history: [],
      userMessage: "Emma, comment ça va ?",
      mode: "text",
      currentSpeakerId: null,
    })) {
      events.push(evt);
    }

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("speaker");
    expect(events[0]).toMatchObject({ speakerId: "emma", speakerRole: "patient" });
    // delta(s) puis done après le speaker.
    expect(types).toContain("delta");
    expect(types.at(-1)).toBe("done");
  });

  it("ambiguous → yields a single `clarification_needed` event, NO OpenAI call", async () => {
    currentStation = RESCOS_70_LIKE;
    openaiChat.mockImplementation(() => {
      throw new Error("OpenAI ne devrait pas être appelé");
    });

    const events: any[] = [];
    for await (const evt of streamPatientChat({
      stationId: "RESCOS-70-T",
      history: [],
      userMessage: "Bonjour, je suis le médecin.",
      mode: "text",
      currentSpeakerId: null,
    })) {
      events.push(evt);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("clarification_needed");
    expect(events[0].candidates.map((c: any) => c.id).sort()).toEqual(["emma", "mother"]);
    expect(openaiChat).not.toHaveBeenCalled();
  });

  it("mono-patient legacy stream emits speaker=patient then deltas", async () => {
    currentStation = MONO_PATIENT_LEGACY;
    openaiChat.mockResolvedValue(makeOpenAiStream("J'ai mal."));

    const events: any[] = [];
    for await (const evt of streamPatientChat({
      stationId: "MONO-1",
      history: [],
      userMessage: "Bonjour.",
      mode: "text",
    })) {
      events.push(evt);
    }

    expect(events[0].type).toBe("speaker");
    expect(events[0].speakerId).toBe("patient");
    expect(events[0].speakerRole).toBe("patient");
  });
});
