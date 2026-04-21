// Préférences utilisateur stockées côté client (non sensibles).
// Les clés API ne transitent JAMAIS par localStorage — seules les préférences UI y vivent.

import type { TtsVoice } from "./api";

const VOICE_KEY = "osce.voice";
const DEFAULT_VOICE: TtsVoice = "nova";

const ALLOWED: TtsVoice[] = ["alloy", "echo", "fable", "nova", "onyx", "shimmer"];

export function getPreferredVoice(): TtsVoice {
  try {
    const raw = window.localStorage.getItem(VOICE_KEY);
    if (raw && (ALLOWED as string[]).includes(raw)) return raw as TtsVoice;
  } catch { /* localStorage indisponible (SSR, mode privé) */ }
  return DEFAULT_VOICE;
}

export function setPreferredVoice(voice: TtsVoice): void {
  try {
    window.localStorage.setItem(VOICE_KEY, voice);
  } catch { /* noop */ }
}
