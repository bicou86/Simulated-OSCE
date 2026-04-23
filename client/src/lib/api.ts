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
  // Garde-fou : si le serveur répond 200 mais avec du HTML (typiquement le
  // catch-all Vite/SPA qui avale un /api/* non enregistré — serveur dev pas
  // redémarré, route mal nommée, ou contournement d'ordre de middleware),
  // surface un message clair plutôt que l'énigmatique `Unexpected token '<'`
  // de JSON.parse. Log les 200 premiers caractères en console pour le debug.
  const contentType = res.headers.get("content-type") || "";
  if (!/(application|text)\/json/i.test(contentType)) {
    const snippet = await res
      .text()
      .then((t) => t.slice(0, 200).replace(/\s+/g, " ").trim())
      .catch(() => "");
    // eslint-disable-next-line no-console
    console.error(
      `[api] Réponse non-JSON reçue de ${url} (Content-Type: ${contentType || "?"}, status ${res.status}): ${snippet}`,
    );
    throw new ApiError({
      message:
        `Réponse non-JSON du serveur pour ${url} — l'endpoint n'est probablement pas enregistré. ` +
        `Redémarrez le serveur de dev si vous venez d'ajouter cette route.`,
      code: "upstream_error",
      hint: snippet ? `Premiers caractères reçus : ${snippet}` : undefined,
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

export type StationType =
  | "teleconsultation"
  | "pediatrie_accompagnant"
  | "bbn"
  | "psy"
  | "triage"
  | "anamnese_examen";

export interface StationMeta {
  id: string;       // "RESCOS-1"
  title: string;
  source: StationSource;
  setting: string;
  stationType?: StationType;
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

export type InterlocutorType = "self" | "parent";
export type ParentRole = "mother" | "father" | "caregiver";

export interface Interlocutor {
  type: InterlocutorType;
  parentRole?: ParentRole;
  parentPresent?: boolean;
  reason: string;
}

export interface PatientBrief {
  stationId: string;
  setting: string;
  patientDescription: string;
  vitals: Record<string, string>;
  phraseOuverture: string;
  phraseOuvertureComplement?: string;
  sex: PatientSex;
  age?: number;
  interlocutor: Interlocutor;
  stationType?: StationType;
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

// ───────── /api/examiner ─────────
// Lookup déterministe d'un finding d'examen physique depuis la grille patient
// (aucun appel LLM côté serveur). Le champ `kind` est le discriminator
// canonique — les champs historiques (`match`, `resultat`, `fallback`) restent
// présents pour la compatibilité avec les clients non encore migrés.

export type ExaminerLookupKind =
  | "finding"        // finding unique, `resultat` disponible
  | "findings"       // plusieurs findings agrégés → voir `items`
  | "no_resultat"    // manœuvre reconnue, pas de finding à rapporter
  | "no_match"       // aucune manœuvre reconnue dans la grille
  | "no_teleconsult"; // cadre téléconsultation — examen physique impossible

export interface ExaminerLookupItem {
  categoryKey: string;
  categoryName: string;
  maneuver: string;
  resultat: string;
  source?: "title_as_result";
}

export interface ExaminerLookupResult {
  match: boolean;
  kind: ExaminerLookupKind;
  stationId: string;
  query: string;
  categoryKey?: string;
  categoryName?: string;
  maneuver?: string;
  resultat?: string;
  source?: "title_as_result";
  items?: ExaminerLookupItem[];
  fallback?: string;
}

export function examinerLookup(
  stationId: string,
  query: string,
  signal?: AbortSignal,
): Promise<ExaminerLookupResult> {
  return jsonFetch("/api/examiner/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stationId, query }),
    signal,
  });
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
  stationType?: StationType;
  communicationWeight?: number;
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

// Table statique de pondération exposée par le backend — consommée par la
// page évaluation pour afficher le poids à côté de chaque score d'axe.
// Immuable côté front ; l'édition se fait dans shared/evaluation-weights.ts.
export type EvaluationAxis =
  | "anamnese"
  | "examen"
  | "management"
  | "cloture"
  | "communication";

export interface AxisWeights {
  anamnese: number;
  examen: number;
  management: number;
  cloture: number;
  communication: number;
}

export interface EvaluationWeightsResponse {
  axes: readonly EvaluationAxis[];
  weights: Record<StationType, AxisWeights>;
}

export function getEvaluationWeights(): Promise<EvaluationWeightsResponse> {
  return jsonFetch("/api/evaluator/weights", { method: "GET" });
}
