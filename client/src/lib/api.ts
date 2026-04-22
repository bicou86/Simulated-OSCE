// Client typé pour les endpoints du backend OSCE Sim.
// Tous les appels passent par /api/*. Les erreurs sont normalisées via ApiError.

export type ApiErrorCode =
  | "unauthorized"
  | "rate_limited"
  | "upstream_error"
  | "bad_request"
  | "not_configured"
  | "internal_error"
  | "not_found"
  | "network_error"
  // Emis côté client quand une réponse "200 OK" n'est pas du SSE (ex. fallback SPA
  // qui renvoie index.html). Le consommateur doit basculer sur l'endpoint non-stream.
  | "invalid_sse_response";

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

async function parseErrorBody(res: Response): Promise<{ error?: string; code?: ApiErrorCode; hint?: string }> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function jsonFetch<T>(url: string, init: RequestInit): Promise<T> {
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
    const body = await parseErrorBody(res);
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

// ───────── /api/stations ─────────

export type StationSource = "AMBOSS" | "German" | "RESCOS" | "USMLE" | "USMLE_Triage";

export interface StationMeta {
  id: string;       // "RESCOS-1"
  title: string;
  source: StationSource;
  setting: string;
}

export function listStations(): Promise<{ stations: StationMeta[]; total: number }> {
  return jsonFetch("/api/stations", { method: "GET" });
}

// ───────── /api/patient ─────────

export type ChatRole = "user" | "assistant";

export interface ChatInput {
  stationId: string;
  history: Array<{ role: ChatRole; content: string }>;
  userMessage: string;
  mode: "voice" | "text";
  model?: "gpt-4o-mini" | "gpt-4o";
}

export function chatPatient(input: ChatInput): Promise<{ reply: string }> {
  return jsonFetch("/api/patient/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type PatientSex = "male" | "female" | "unknown";

export interface PatientBrief {
  stationId: string;
  setting: string;
  patientDescription: string;
  vitals: Record<string, string>;
  phraseOuverture: string;
  phraseOuvertureComplement?: string;
  sex: PatientSex;
  age?: number;
}

export function getPatientBrief(stationId: string): Promise<PatientBrief> {
  return jsonFetch(`/api/patient/${encodeURIComponent(stationId)}/brief`, { method: "GET" });
}

export async function sttPatient(audio: Blob, filename = "audio.webm"): Promise<{ text: string }> {
  const form = new FormData();
  form.append("audio", audio, filename);
  let res: Response;
  try {
    res = await fetch("/api/patient/stt", { method: "POST", body: form });
  } catch (err) {
    throw new ApiError({ message: (err as Error).message, code: "network_error", status: 0 });
  }
  if (!res.ok) {
    const body = await parseErrorBody(res);
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

export async function ttsPatient(text: string, voice: TtsVoice = "nova"): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch("/api/patient/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
    });
  } catch (err) {
    throw new ApiError({ message: (err as Error).message, code: "network_error", status: 0 });
  }
  if (!res.ok) {
    const body = await parseErrorBody(res);
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

export interface EvaluationScores {
  globalScore: number;
  sections: Array<{
    key: string;
    name: string;
    weight: number;
    score: number;
    raw?: string;
  }>;
  verdict: "Réussi" | "À retravailler" | "Échec";
}

export interface EvaluationResult {
  markdown: string;
  scores: EvaluationScores;
}

export interface EvaluateInput {
  stationId: string;
  transcript: Array<{ role: "patient" | "doctor"; text: string }>;
  model?: "claude-sonnet-4-5" | "claude-opus-4-7";
}

export function evaluate(input: EvaluateInput): Promise<EvaluationResult> {
  return jsonFetch("/api/evaluator/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
