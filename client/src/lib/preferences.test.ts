// Tests de la logique de résolution de voix + sérialisation des préférences.
// - resolveVoice : comportement attendu pour chaque combinaison (auto on/off, sexe, âge)
// - get/setVoicePreferences : round-trip via localStorage (happy-dom)
// - get/setConversationPreferences : clamp des valeurs hors plage

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONVERSATION_BOUNDS,
  getConversationPreferences,
  getVoicePreferences,
  participantSpeakerLabel,
  resolveVoice,
  setConversationPreferences,
  setVoicePreferences,
} from "./preferences";
import type { PatientBrief } from "./api";

type ResolveArg = Pick<PatientBrief, "sex" | "age" | "interlocutor">;

function brief(sex: PatientBrief["sex"], age?: number): ResolveArg {
  return { sex, age, interlocutor: { type: "self", reason: "test" } };
}

function briefWithParent(
  sex: PatientBrief["sex"],
  age: number | undefined,
  parentRole: "mother" | "father" | "caregiver",
): ResolveArg {
  return { sex, age, interlocutor: { type: "parent", parentRole, reason: "test" } };
}

describe("resolveVoice", () => {
  const defaults = {
    autoVoiceBySex: true,
    preferredVoice: "alloy" as const,
    maleVoice: "onyx" as const,
    femaleVoice: "nova" as const,
  };

  it("returns femaleVoice for female patient", () => {
    expect(resolveVoice(brief("female"), defaults)).toBe("nova");
  });

  it("returns maleVoice for male patient", () => {
    expect(resolveVoice(brief("male"), defaults)).toBe("onyx");
  });

  it("returns preferredVoice for unknown sex and no pediatric", () => {
    expect(resolveVoice(brief("unknown"), defaults)).toBe("alloy");
  });

  it("returns femaleVoice for pediatric case (age < 12) regardless of sex", () => {
    // Garçon pédiatrique → voix féminine (plus douce, OpenAI ne gère pas vraiment voix d'enfant)
    expect(resolveVoice(brief("male", 6), defaults)).toBe("nova");
    expect(resolveVoice(brief("female", 2), defaults)).toBe("nova");
    expect(resolveVoice(brief("unknown", 10), defaults)).toBe("nova");
  });

  it("returns maleVoice for adolescent male (age >= 12)", () => {
    expect(resolveVoice(brief("male", 12), defaults)).toBe("onyx");
    expect(resolveVoice(brief("male", 15), defaults)).toBe("onyx");
  });

  it("returns preferredVoice when autoVoiceBySex is OFF", () => {
    const prefs = { ...defaults, autoVoiceBySex: false };
    expect(resolveVoice(brief("female"), prefs)).toBe("alloy");
    expect(resolveVoice(brief("male"), prefs)).toBe("alloy");
    expect(resolveVoice(brief("male", 6), prefs)).toBe("alloy"); // pediatric ignored when auto OFF
  });

  it("returns preferredVoice when brief is null/undefined", () => {
    expect(resolveVoice(null, defaults)).toBe("alloy");
    expect(resolveVoice(undefined, defaults)).toBe("alloy");
  });

  // ─ Interlocutor takes precedence over pediatric rule ─
  it("parent/mother → femaleVoice, even if patient is pediatric boy", () => {
    expect(resolveVoice(briefWithParent("male", 2, "mother"), defaults)).toBe("nova");
  });

  it("parent/father → maleVoice, even if patient is pediatric girl", () => {
    expect(resolveVoice(briefWithParent("female", 2, "father"), defaults)).toBe("onyx");
  });

  it("parent/caregiver → femaleVoice (default when role ambiguous)", () => {
    expect(resolveVoice(briefWithParent("unknown", undefined, "caregiver"), defaults)).toBe("nova");
  });

  it("parent interlocutor bypasses pediatric rule (age < 12 doesn't force female for father)", () => {
    // Père d'un garçon de 6 ans → masculin, pas féminin comme le ferait la règle pédiatrique.
    expect(resolveVoice(briefWithParent("male", 6, "father"), defaults)).toBe("onyx");
  });

  it("parent interlocutor still respects autoVoiceBySex OFF override", () => {
    const prefs = { ...defaults, autoVoiceBySex: false };
    expect(resolveVoice(briefWithParent("male", 2, "mother"), prefs)).toBe("alloy");
  });
});

describe("voice preferences round-trip", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("defaults when nothing persisted", () => {
    const prefs = getVoicePreferences();
    expect(prefs).toEqual({
      autoVoiceBySex: true,
      preferredVoice: "nova",
      maleVoice: "onyx",
      femaleVoice: "nova",
    });
  });

  it("persists and re-reads patch", () => {
    setVoicePreferences({ autoVoiceBySex: false, maleVoice: "echo", femaleVoice: "shimmer" });
    expect(getVoicePreferences()).toEqual({
      autoVoiceBySex: false,
      preferredVoice: "nova",
      maleVoice: "echo",
      femaleVoice: "shimmer",
    });
  });

  it("ignores unknown voice values in localStorage (corrupt)", () => {
    localStorage.setItem("osce.voice.male", "not-a-voice");
    expect(getVoicePreferences().maleVoice).toBe("onyx"); // default
  });
});

describe("conversation preferences", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("defaults when nothing persisted", () => {
    expect(getConversationPreferences()).toEqual({
      enabled: false,
      silenceThresholdMs: 1500,
      minSpeechDurationMs: 400,
    });
  });

  it("clamps out-of-range values on set", () => {
    setConversationPreferences({ silenceThresholdMs: 99999, minSpeechDurationMs: -50 });
    const prefs = getConversationPreferences();
    expect(prefs.silenceThresholdMs).toBe(CONVERSATION_BOUNDS.silenceMax);
    expect(prefs.minSpeechDurationMs).toBe(CONVERSATION_BOUNDS.minSpeechMin);
  });

  it("clamps out-of-range values on read (protects against manual localStorage edits)", () => {
    localStorage.setItem("osce.conv.silenceMs", "99999");
    localStorage.setItem("osce.conv.minSpeechMs", "-50");
    const prefs = getConversationPreferences();
    expect(prefs.silenceThresholdMs).toBe(CONVERSATION_BOUNDS.silenceMax);
    expect(prefs.minSpeechDurationMs).toBe(CONVERSATION_BOUNDS.minSpeechMin);
  });

  it("persists enabled toggle", () => {
    setConversationPreferences({ enabled: true });
    expect(getConversationPreferences().enabled).toBe(true);
  });
});

// ─── Phase 4 J2 — participantSpeakerLabel (label per-message) ─────────────

describe("participantSpeakerLabel", () => {
  const multiBrief: PatientBrief = {
    stationId: "RESCOS-70",
    setting: "Cabinet",
    patientDescription: "Emma 16 ans + mère",
    vitals: {},
    phraseOuverture: "",
    sex: "female",
    age: 16,
    interlocutor: { type: "self", reason: "test" },
    participants: [
      {
        id: "emma",
        role: "patient",
        name: "Emma Delacroix",
        age: 16,
        vocabulary: "lay",
        knowledgeScope: ["self.symptoms"],
      },
      {
        id: "mother",
        role: "accompanying",
        name: "Mère d'Emma Delacroix",
        vocabulary: "lay",
        knowledgeScope: ["family.history"],
      },
    ],
    defaultSpeakerId: "emma",
  };

  const monoBrief: PatientBrief = {
    stationId: "RESCOS-1",
    setting: "Cabinet",
    patientDescription: "Adulte 47 ans",
    vitals: {},
    phraseOuverture: "",
    sex: "female",
    age: 47,
    interlocutor: { type: "self", reason: "adult" },
    // pas de participants[] : station mono-patient legacy
  };

  it("multi-profile + speaker patient → 'Patient'", () => {
    expect(participantSpeakerLabel(multiBrief, "emma")).toBe("Patient");
  });

  it("multi-profile + speaker accompanying → 'Accompagnant·e'", () => {
    expect(participantSpeakerLabel(multiBrief, "mother")).toBe("Accompagnant·e");
  });

  it("multi-profile + unknown speakerId → fallback legacy interlocutor label", () => {
    // L'id ne matche aucun participant ⇒ on retombe sur
    // interlocutorSpeakerLabel(brief), qui pour `interlocutor.type=self`
    // renvoie « Patient ».
    expect(participantSpeakerLabel(multiBrief, "ghost")).toBe("Patient");
  });

  it("mono-patient (no participants[]) → fallback legacy quel que soit le speakerId", () => {
    expect(participantSpeakerLabel(monoBrief, "patient")).toBe("Patient");
    expect(participantSpeakerLabel(monoBrief, null)).toBe("Patient");
  });

  it("null brief → 'Patient' (defensive default)", () => {
    expect(participantSpeakerLabel(null, "emma")).toBe("Patient");
  });

  it("brief sans speakerId fourni → fallback legacy", () => {
    expect(participantSpeakerLabel(multiBrief, undefined)).toBe("Patient");
  });
});
