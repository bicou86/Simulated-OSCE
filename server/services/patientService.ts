// Service Patient — isolation stricte des données patient.
// N'accède JAMAIS aux fichiers Examinateur_*.json.
// Charge la station patient à la demande + construit le system prompt + appelle OpenAI.

import { promises as fs } from "fs";
import OpenAI from "openai";
import { getOpenAIKey } from "../lib/config";
import { loadPrompt } from "../lib/prompts";
import { getStationMeta, patientFilePath } from "./stationsService";

// Cache des fichiers JSON déjà parsés (clé = filename).
const fileCache = new Map<string, any[]>();

async function loadFile(filename: string): Promise<any[]> {
  const cached = fileCache.get(filename);
  if (cached) return cached;
  const content = await fs.readFile(patientFilePath(filename), "utf-8");
  const parsed = JSON.parse(content) as { stations: any[] };
  fileCache.set(filename, parsed.stations);
  return parsed.stations;
}

export class StationNotFoundError extends Error {
  constructor(public readonly stationId: string) {
    super(`Station ${stationId} introuvable dans le catalogue patient.`);
    this.name = "StationNotFoundError";
  }
}

// Retourne la station patient complète (script, histoire, habitudes, etc.).
export async function getPatientStation(stationId: string): Promise<any> {
  const meta = getStationMeta(stationId);
  if (!meta) throw new StationNotFoundError(stationId);
  const stations = await loadFile(meta.patientFile);
  const station = stations[meta.indexInFile];
  if (!station || station.id !== meta.fullId) {
    // Index désynchronisé — fallback par recherche ID.
    const fallback = stations.find((s) => s.id === meta.fullId);
    if (!fallback) throw new StationNotFoundError(stationId);
    return fallback;
  }
  return station;
}

export interface PatientBrief {
  stationId: string;
  setting: string;
  patientDescription: string;
  vitals: Record<string, string>;
  phraseOuverture: string;
  phraseOuvertureComplement?: string;
}

// "Feuille de porte" + phrase d'ouverture — tout ce dont l'UI a besoin côté étudiant :
// elle peut afficher les signes vitaux / cadre / description sans faire d'appel LLM.
// Aucune donnée de scoring ni script anamnèse complet n'est renvoyée.
export async function getPatientBrief(stationId: string): Promise<PatientBrief> {
  const station = await getPatientStation(stationId);
  return {
    stationId,
    setting: station.setting ?? "",
    patientDescription: station.patient_description ?? "",
    vitals: station.vitals ?? {},
    phraseOuverture: station.ouverture ?? station.phrase_ouverture ?? "",
    phraseOuvertureComplement: station.ouverture_complement ?? station.phrase_ouverture_complement,
  };
}

// Directive additionnelle injectée quand l'étudiant interagit au clavier plutôt qu'à la voix.
const TEXT_MODE_DIRECTIVE = `

## ADAPTATION
La conversation se déroule en mode texte, pas en mode vocal. Tu peux répondre avec des phrases légèrement plus construites, mais reste naturel et bref.`;

// Construit le system prompt complet : markdown + bloc <station_data>.
export async function buildSystemPrompt(
  stationId: string,
  mode: "voice" | "text",
): Promise<string> {
  const [template, station] = await Promise.all([
    loadPrompt("patient"),
    getPatientStation(stationId),
  ]);
  const dataBlock = `\n\n<station_data>\n${JSON.stringify(station, null, 2)}\n</station_data>`;
  const modeDirective = mode === "text" ? TEXT_MODE_DIRECTIVE : "";
  return template + modeDirective + dataBlock;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  stationId: string;
  history: ChatTurn[];
  userMessage: string;
  mode: "voice" | "text";
  model?: string;
}

// Appelle OpenAI Chat Completions. L'historique passé par le client est utilisé tel quel.
export async function runPatientChat(opts: ChatOptions): Promise<string> {
  const key = getOpenAIKey();
  if (!key) throw new Error("OPENAI_API_KEY_MISSING");

  const system = await buildSystemPrompt(opts.stationId, opts.mode);
  const client = new OpenAI({ apiKey: key });
  const completion = await client.chat.completions.create({
    model: opts.model ?? "gpt-4o-mini",
    temperature: 0.7,
    max_tokens: 400,
    messages: [
      { role: "system", content: system },
      ...opts.history,
      { role: "user", content: opts.userMessage },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() ?? "";
}

// ─────────── Streaming ───────────

// Détecte la fin d'une phrase : ponctuation terminale suivie d'un espace ou fin de texte.
// Longueur minimale d'un "flush" pour éviter des abréviations ("Dr. ", "M. ").
const SENTENCE_END = /([.!?…]+)(\s+|$)/;
const MIN_SENTENCE_LENGTH = 12;

export interface StreamEvent {
  type: "delta" | "sentence" | "done" | "error";
  text?: string;
  index?: number;
  fullText?: string;
  code?: string;
  message?: string;
}

// Async generator qui yield des events discrets à partir du flux OpenAI.
// Le consommateur (route SSE) se charge de sérialiser au format text/event-stream.
export async function* streamPatientChat(opts: ChatOptions): AsyncGenerator<StreamEvent> {
  const key = getOpenAIKey();
  if (!key) throw new Error("OPENAI_API_KEY_MISSING");

  const system = await buildSystemPrompt(opts.stationId, opts.mode);
  const client = new OpenAI({ apiKey: key });

  const stream = await client.chat.completions.create({
    model: opts.model ?? "gpt-4o-mini",
    temperature: 0.7,
    max_tokens: 400,
    stream: true,
    messages: [
      { role: "system", content: system },
      ...opts.history,
      { role: "user", content: opts.userMessage },
    ],
  });

  let fullText = "";
  let pending = "";
  let sentenceIndex = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (!delta) continue;
    fullText += delta;
    pending += delta;
    yield { type: "delta", text: delta };

    // Extrait toutes les phrases complètes du buffer courant.
    while (true) {
      const match = pending.match(SENTENCE_END);
      if (!match) break;
      const endIdx = match.index! + match[1].length;
      const candidate = pending.slice(0, endIdx).trim();
      if (candidate.length < MIN_SENTENCE_LENGTH) break;
      yield { type: "sentence", text: candidate, index: sentenceIndex++ };
      pending = pending.slice(endIdx + match[2].length);
    }
  }

  // Fin du stream : flush du buffer restant comme dernière phrase s'il contient du texte.
  const tail = pending.trim();
  if (tail.length > 0) {
    yield { type: "sentence", text: tail, index: sentenceIndex++ };
  }
  yield { type: "done", fullText: fullText.trim() };
}
