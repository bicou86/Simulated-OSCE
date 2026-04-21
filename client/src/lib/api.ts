// Client typé pour les endpoints du backend OSCE Sim.
// Tous les appels passent par /api/*. Les erreurs sont normalisées via ApiError.

export type ApiErrorCode =
  | "unauthorized"
  | "rate_limited"
  | "upstream_error"
  | "bad_request"
  | "not_configured"
  | "internal_error"
  | "network_error";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly hint?: string;
  readonly status: number;
  constructor(opts: { message: string; code: ApiErrorCode; hint?: string; status: number }) {
    super(opts.message);
    this.name = "ApiError";
    this.code = opts.code;
    this.hint = opts.hint;
    this.status = opts.status;
  }
}

// Envoie un JSON, attend un JSON. Relance ApiError avec code/hint si le backend l'a renvoyé.
async function jsonFetch<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ApiError({
      message: (err as Error).message || "Connexion réseau perdue.",
      code: "network_error",
      status: 0,
    });
  }
  if (!res.ok) {
    let body: { error?: string; code?: ApiErrorCode; hint?: string } = {};
    try {
      body = await res.json();
    } catch {
      // rien à faire, on tombera sur le message générique ci-dessous
    }
    throw new ApiError({
      message: body.error ?? `HTTP ${res.status}`,
      code: body.code ?? "internal_error",
      hint: body.hint,
      status: res.status,
    });
  }
  return res.json() as Promise<T>;
}

// ───────── /api/settings ─────────

export interface SettingsStatus {
  openai_ok: boolean;
  openai_reason?: string;
  anthropic_ok: boolean;
  anthropic_reason?: string;
}

export interface SaveSettingsInput {
  openaiKey?: string;
  anthropicKey?: string;
  persist?: boolean;
}

export interface SaveSettingsResult {
  ok: boolean;
  persisted: boolean;
  openaiConfigured: boolean;
  anthropicConfigured: boolean;
}

export function saveSettings(input: SaveSettingsInput): Promise<SaveSettingsResult> {
  return jsonFetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getSettingsStatus(): Promise<SettingsStatus> {
  return jsonFetch("/api/settings/status", { method: "GET" });
}

// ───────── /api/patient ─────────

export interface PatientStation {
  scenario: string;
  context?: string;
  vitals?: {
    hr?: string;
    bp?: string;
    rr?: string;
    temp?: string;
    spo2?: string;
  };
  openingLine?: string;
}

export type ChatRole = "user" | "assistant";

export interface ChatInput {
  station: PatientStation;
  history: Array<{ role: ChatRole; content: string }>;
  userMessage: string;
}

export function chatPatient(input: ChatInput): Promise<{ reply: string }> {
  return jsonFetch("/api/patient/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// STT : POST multipart. On prend un Blob (issu de MediaRecorder) + un filename.
export async function sttPatient(audio: Blob, filename = "audio.webm"): Promise<{ text: string }> {
  const form = new FormData();
  form.append("audio", audio, filename);
  let res: Response;
  try {
    res = await fetch("/api/patient/stt", { method: "POST", body: form });
  } catch (err) {
    throw new ApiError({
      message: (err as Error).message,
      code: "network_error",
      status: 0,
    });
  }
  if (!res.ok) {
    let body: { error?: string; code?: ApiErrorCode; hint?: string } = {};
    try {
      body = await res.json();
    } catch { /* noop */ }
    throw new ApiError({
      message: body.error ?? `HTTP ${res.status}`,
      code: body.code ?? "internal_error",
      hint: body.hint,
      status: res.status,
    });
  }
  return res.json();
}

export type TtsVoice = "alloy" | "echo" | "fable" | "nova" | "onyx" | "shimmer";

// TTS : renvoie un Blob audio/mpeg, à piper dans un Audio element ou AudioContext.
export async function ttsPatient(text: string, voice: TtsVoice = "nova"): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch("/api/patient/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
    });
  } catch (err) {
    throw new ApiError({
      message: (err as Error).message,
      code: "network_error",
      status: 0,
    });
  }
  if (!res.ok) {
    let body: { error?: string; code?: ApiErrorCode; hint?: string } = {};
    try {
      body = await res.json();
    } catch { /* noop */ }
    throw new ApiError({
      message: body.error ?? `HTTP ${res.status}`,
      code: body.code ?? "internal_error",
      hint: body.hint,
      status: res.status,
    });
  }
  return res.blob();
}

// ───────── /api/evaluator ─────────

export interface EvaluationReport {
  globalScore: number;
  anamnese: number;
  examen: number;
  communication: number;
  diagnostic: number;
  strengths: string[];
  criticalOmissions: string[];
  priorities: string[];
  verdict: "Réussi" | "À retravailler" | "Échec";
}

export interface EvaluateInput {
  station: {
    scenario: string;
    title?: string;
    specialty?: string;
  };
  transcript: Array<{ role: "patient" | "doctor"; text: string }>;
}

export function evaluate(input: EvaluateInput): Promise<EvaluationReport> {
  return jsonFetch("/api/evaluator/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
