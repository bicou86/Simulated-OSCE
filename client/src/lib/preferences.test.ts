// Tests de la logique de résolution de voix + sérialisation des préférences.
// - resolveVoice : comportement attendu pour chaque combinaison (auto on/off, sexe, âge)
// - get/setVoicePreferences : round-trip via localStorage (happy-dom)
// - get/setConversationPreferences : clamp des valeurs hors plage

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONVERSATION_BOUNDS,
  getConversationPreferences,
  getVoicePreferences,
  resolveVoice,
  setConversationPreferences,
  setVoicePreferences,
} from "./preferences";
import type { PatientBrief } from "./api";

function brief(sex: PatientBrief["sex"], age?: number): Pick<PatientBrief, "sex" | "age"> {
  return { sex, age };
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
