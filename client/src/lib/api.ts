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
  // Phase 4 J2 — id du participant qui a parlé au tour précédent (sticky).
  // Le serveur l'utilise pour le routage d'adresse sur les stations
  // multi-profils. Optionnel : à T0 le client passe brief.defaultSpeakerId
  // (ou null), le serveur retombera sur l'ambiguïté → UI de clarification.
  currentSpeakerId?: string | null;
  // Phase 9 J1 — discriminant flow conversationnel pour stations doubles
  // partie 2 (shortId -P2). "examiner" : LLM ouvre la conversation et pose
  // les 15 questions ordonnées. "patient" (défaut, omis = patient) : flow
  // patient simulé classique des 287 autres stations.
  conversationMode?: "patient" | "examiner";
}

// Phase 4 J2 — réponse de /api/patient/chat. Discriminated union :
//   • `reply` (cas normal) ⇒ texte LLM + tag du speaker (id + role).
//   • `clarification_needed` ⇒ le routeur n'a pas pu trancher, l'UI
//     affiche un panneau avec boutons profils, AUCUN appel LLM consommé.
export type ParticipantRoleClient = "patient" | "accompanying" | "witness";

export interface ChatReplyOk {
  type: "reply";
  reply: string;
  speakerId: string;
  speakerRole: ParticipantRoleClient;
}
export interface ChatReplyClarification {
  type: "clarification_needed";
  reason: string;
  candidates: Array<{ id: string; name: string; role: ParticipantRoleClient }>;
}
export type ChatReply = ChatReplyOk | ChatReplyClarification;

export function chatPatient(input: ChatInput): Promise<ChatReply> {
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

// Phase 4 J2 — sous-shape Participant côté client (miroir du schéma Zod
// shared/station-schema.ts, dupliqué pour ne pas tirer la dépendance Zod
// dans le bundle navigateur).
export interface ClientParticipant {
  id: string;
  role: ParticipantRoleClient;
  name: string;
  age?: number;
  vocabulary: "medical" | "lay";
  knowledgeScope: string[];
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
  // Phase 4 J2 — composition multi-profils. `participants` est défini
  // UNIQUEMENT pour les stations annotées avec ≥ 2 participants. Pour les
  // stations mono-patient legacy, le champ est absent et l'UI conserve
  // l'affichage historique (label « Patient (voix IA) »).
  participants?: ClientParticipant[];
  // Le participant qui répond par défaut au tout premier tour. Sert à
  // initialiser `currentSpeakerId` côté client.
  defaultSpeakerId?: string;
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
  | "no_teleconsult" // cadre téléconsultation — examen physique impossible
  | "no_imaging";    // Phase 3 — imagerie demandée, station n'en contient pas

export interface ExaminerLookupItem {
  categoryKey: string;
  categoryName: string;
  maneuver: string;
  resultat: string;
  source?: "title_as_result";
  resultatType?: "text" | "image";
  resultatUrl?: string;
  resultatCaption?: string;
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
  resultatType?: "text" | "image";
  resultatUrl?: string;
  resultatCaption?: string;
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

// ───────── /api/examiner/labs (Phase 3 J2) ─────────
// Retour structuré : labs résolus avec paramètres, flags calculés, sources
// cliniques. Symétrique à ExaminerLookupResult mais avec `results[]` au lieu
// d'une bulle unique ; plusieurs labs peuvent être demandés dans la même
// phrase ("NFS + CRP") → on renvoie 1 entrée par lab.

export type LabFlag = "low" | "normal" | "high" | "critical";

export interface LabsLookupParameter {
  key: string;
  label: string;
  value: number | string;
  unit: string;
  flag: LabFlag;
  normalRange: { min: number; max: number; source: "adult" | "pediatric" };
  criticalLow?: number;
  criticalHigh?: number;
  sourceRef?: string;
  note?: string;
}

export interface LabsLookupResolvedResult {
  key: string;
  label: string;
  parameters: LabsLookupParameter[];
  interpretation?: string;
}

export type LabsLookupKind =
  | "labs"
  | "no_match"
  | "no_labs"
  | "no_teleconsult";

export interface LabsLookupResult {
  match: boolean;
  kind: LabsLookupKind;
  stationId: string;
  query: string;
  results?: LabsLookupResolvedResult[];
  fallback?: string;
  requestedLabKeys?: string[];
}

export function labsLookup(
  stationId: string,
  query: string,
  signal?: AbortSignal,
): Promise<LabsLookupResult> {
  return jsonFetch("/api/examiner/labs", {
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
  // Phase 7 J2/J4 — 6e axe additif. Présent UNIQUEMENT quand la station
  // a un legalContext annoté (5/288 stations à Phase 8 J2 : AMBOSS-24,
  // USMLE-34, RESCOS-72, USMLE Triage 39, USMLE-9 ; était 5/287 fin
  // Phase 7). Les ~283 autres stations ne portent aucun de ces deux
  // champs (undefined ⇒ UI ne rend pas la 6e ligne, rétrocompat
  // byte-à-byte vs Phase 6).
  //   • medicoLegalScore  : 0–100, agrégé depuis legalEvaluator (moyenne
  //                          uniforme 25 % par sous-axe).
  //   • medicoLegalWeight : 10 (le poids effectif en %, identique pour
  //                          toutes les stations avec legalContext).
  medicoLegalScore?: number;
  medicoLegalWeight?: number;
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

// ───────── /api/evaluation/legal (Phase 5 J2/J4) ─────────
//
// Évaluation médico-légale heuristique 100 % déterministe (zéro LLM côté
// serveur). N'est pertinente QUE pour les stations portant un
// `legalContext` ; pour les autres, l'endpoint répond 400 et l'UI ne
// rend simplement pas le panel.
//
// L'UI consomme cet endpoint EN PARALLÈLE de /api/evaluator/evaluate
// pour ne pas allonger la latence de la page Evaluation (Phase 2/3 prend
// ~10 s avec Sonnet ; legal est instantané).

export type LegalAxisKey = "reconnaissance" | "verbalisation" | "decision" | "communication";

export interface LegalAxisItemReport {
  text: string;
  concept: string;
  isAntiPattern: boolean;
  matchedPatterns: number;
  grade: -2 | -1 | 0 | 1 | 2;
}

export interface LegalAxisReport {
  axis: LegalAxisKey;
  items: LegalAxisItemReport[];
  score_pct: number;
}

export interface LegalEvaluation {
  stationId: string;
  category: string;
  expected_decision:
    | "report"
    | "no_report"
    | "defer"
    | "refer"
    | "decline_certificate";
  mandatory_reporting: boolean;
  axes: Record<LegalAxisKey, LegalAxisReport>;
  missing: string[];
  avoided: string[];
  unmapped: string[];
  lexiconVersion: string;
}

export interface EvaluateLegalInput {
  stationId: string;
  transcript: string;
}

export function evaluateLegal(input: EvaluateLegalInput): Promise<LegalEvaluation> {
  return jsonFetch("/api/evaluation/legal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
