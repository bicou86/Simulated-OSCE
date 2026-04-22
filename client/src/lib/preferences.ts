// Préférences utilisateur stockées côté client (non sensibles).
// Les clés API ne transitent JAMAIS par localStorage — seules les préférences UI y vivent.
//
// Deux groupes de préférences :
//   - Voix : voix par défaut (fallback) + voix masculine/féminine + auto-sélection par sexe
//   - Mode conversation : toggle global + seuils VAD (silence min, durée voix min)

import type { PatientBrief, TtsVoice } from "./api";

const ALLOWED_VOICES: TtsVoice[] = ["alloy", "echo", "fable", "nova", "onyx", "shimmer"];

// ─────────────── Voix ───────────────

const PREF_VOICE = "osce.voice";
const PREF_AUTO_BY_SEX = "osce.voice.autoBySex";
const PREF_MALE_VOICE = "osce.voice.male";
const PREF_FEMALE_VOICE = "osce.voice.female";

const DEFAULT_VOICE: TtsVoice = "nova";
const DEFAULT_MALE: TtsVoice = "onyx";
const DEFAULT_FEMALE: TtsVoice = "nova";

export interface VoicePreferences {
  autoVoiceBySex: boolean;
  preferredVoice: TtsVoice;   // fallback (auto OFF ou sexe unknown sans cas pédiatrique)
  maleVoice: TtsVoice;
  femaleVoice: TtsVoice;
}

function readVoice(key: string, fallback: TtsVoice): TtsVoice {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw && (ALLOWED_VOICES as string[]).includes(raw)) return raw as TtsVoice;
  } catch { /* localStorage indisponible */ }
  return fallback;
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch { /* noop */ }
  return fallback;
}

function writeBool(key: string, value: boolean): void {
  try { window.localStorage.setItem(key, String(value)); } catch { /* noop */ }
}

// Retro-compat : l'ancien getPreferredVoice lisait uniquement VOICE_KEY.
export function getPreferredVoice(): TtsVoice {
  return readVoice(PREF_VOICE, DEFAULT_VOICE);
}

export function setPreferredVoice(voice: TtsVoice): void {
  try { window.localStorage.setItem(PREF_VOICE, voice); } catch { /* noop */ }
}

export function getVoicePreferences(): VoicePreferences {
  return {
    autoVoiceBySex: readBool(PREF_AUTO_BY_SEX, true),
    preferredVoice: readVoice(PREF_VOICE, DEFAULT_VOICE),
    maleVoice: readVoice(PREF_MALE_VOICE, DEFAULT_MALE),
    femaleVoice: readVoice(PREF_FEMALE_VOICE, DEFAULT_FEMALE),
  };
}

export function setVoicePreferences(patch: Partial<VoicePreferences>): void {
  if (patch.autoVoiceBySex !== undefined) writeBool(PREF_AUTO_BY_SEX, patch.autoVoiceBySex);
  if (patch.preferredVoice) setPreferredVoice(patch.preferredVoice);
  if (patch.maleVoice) {
    try { window.localStorage.setItem(PREF_MALE_VOICE, patch.maleVoice); } catch { /* noop */ }
  }
  if (patch.femaleVoice) {
    try { window.localStorage.setItem(PREF_FEMALE_VOICE, patch.femaleVoice); } catch { /* noop */ }
  }
}

// Résout la voix effective à utiliser pour un brief donné.
// Ordre de priorité (du plus spécifique au plus général) :
//   1. autoVoiceBySex OFF → preferredVoice (override utilisateur)
//   2. interlocutor.type === "parent" → voix selon parentRole (mère = féminine,
//      père = masculine, accompagnant·e → féminine par défaut). La règle
//      pédiatrique ne s'applique PAS : on a un adulte en face.
//   3. age < 12 (cas pédiatrique self) → femaleVoice (OpenAI TTS ne sait pas
//      imiter une voix d'enfant, mais féminin = plus doux)
//   4. sex → male/female voice ; unknown → preferredVoice
export function resolveVoice(
  brief: Pick<PatientBrief, "sex" | "age" | "interlocutor"> | null | undefined,
  prefs: VoicePreferences,
): TtsVoice {
  if (!brief || !prefs.autoVoiceBySex) return prefs?.preferredVoice ?? "nova";
  const it = brief.interlocutor;
  if (it?.type === "parent") {
    if (it.parentRole === "father") return prefs.maleVoice;
    // mother, caregiver, ou undefined → féminine par défaut
    return prefs.femaleVoice;
  }
  if (typeof brief.age === "number" && brief.age < 12) return prefs.femaleVoice;
  if (brief.sex === "female") return prefs.femaleVoice;
  if (brief.sex === "male") return prefs.maleVoice;
  return prefs.preferredVoice;
}

// Libellé pour l'UI (feuille de porte + label du transcript).
// "Patient (voix IA)" / "Mère du patient (voix IA)" / "Père du patient (voix IA)".
export function interlocutorSpeakerLabel(brief: Pick<PatientBrief, "interlocutor"> | null | undefined): string {
  const it = brief?.interlocutor;
  if (!it || it.type === "self") return "Patient";
  switch (it.parentRole) {
    case "mother": return "Mère du patient";
    case "father": return "Père du patient";
    case "caregiver": return "Accompagnant·e";
    default: return "Accompagnant·e";
  }
}

// Libellé pour la feuille de porte sous "Patient" (quand type=parent).
// "la mère" / "le père" / "l'accompagnant·e".
export function interlocutorArticle(brief: Pick<PatientBrief, "interlocutor"> | null | undefined): string {
  const it = brief?.interlocutor;
  if (!it || it.type === "self") return "";
  switch (it.parentRole) {
    case "mother": return "la mère";
    case "father": return "le père";
    case "caregiver": return "l'accompagnant·e";
    default: return "l'accompagnant·e";
  }
}

// ─────────────── Mode conversation (VAD auto-silence) ───────────────

const PREF_CONV_ENABLED = "osce.conv.enabled";
const PREF_CONV_SILENCE_MS = "osce.conv.silenceMs";
const PREF_CONV_MIN_SPEECH_MS = "osce.conv.minSpeechMs";

const DEFAULT_SILENCE_MS = 1500;
const DEFAULT_MIN_SPEECH_MS = 400;

// Plages "raisonnables" pour éviter qu'un utilisateur saisisse des valeurs absurdes.
const SILENCE_MIN = 500;
const SILENCE_MAX = 5000;
const MIN_SPEECH_MIN = 100;
const MIN_SPEECH_MAX = 2000;

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function readNumber(key: string, fallback: number, lo: number, hi: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) return clamp(Number(raw), lo, hi);
  } catch { /* noop */ }
  return fallback;
}

export interface ConversationPreferences {
  enabled: boolean;
  silenceThresholdMs: number;
  minSpeechDurationMs: number;
}

export function getConversationPreferences(): ConversationPreferences {
  return {
    enabled: readBool(PREF_CONV_ENABLED, false),
    silenceThresholdMs: readNumber(PREF_CONV_SILENCE_MS, DEFAULT_SILENCE_MS, SILENCE_MIN, SILENCE_MAX),
    minSpeechDurationMs: readNumber(PREF_CONV_MIN_SPEECH_MS, DEFAULT_MIN_SPEECH_MS, MIN_SPEECH_MIN, MIN_SPEECH_MAX),
  };
}

export function setConversationPreferences(patch: Partial<ConversationPreferences>): void {
  if (patch.enabled !== undefined) writeBool(PREF_CONV_ENABLED, patch.enabled);
  if (patch.silenceThresholdMs !== undefined) {
    try {
      window.localStorage.setItem(
        PREF_CONV_SILENCE_MS,
        String(clamp(patch.silenceThresholdMs, SILENCE_MIN, SILENCE_MAX)),
      );
    } catch { /* noop */ }
  }
  if (patch.minSpeechDurationMs !== undefined) {
    try {
      window.localStorage.setItem(
        PREF_CONV_MIN_SPEECH_MS,
        String(clamp(patch.minSpeechDurationMs, MIN_SPEECH_MIN, MIN_SPEECH_MAX)),
      );
    } catch { /* noop */ }
  }
}

export const CONVERSATION_BOUNDS = {
  silenceMin: SILENCE_MIN,
  silenceMax: SILENCE_MAX,
  minSpeechMin: MIN_SPEECH_MIN,
  minSpeechMax: MIN_SPEECH_MAX,
} as const;
