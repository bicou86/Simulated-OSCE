// Service Patient — isolation stricte des données patient.
// N'accède JAMAIS aux fichiers Examinateur_*.json.
// Charge la station patient à la demande + construit le system prompt + appelle OpenAI.

import { promises as fs } from "fs";
import OpenAI from "openai";
import { getOpenAIKey } from "../lib/config";
import { logRequest } from "../lib/logger";
import { extractAge, extractSex, type PatientSex } from "../lib/patientSex";
import {
  resolveInterlocutor,
  type Interlocutor,
} from "../lib/patientInterlocutor";
import { loadPrompt } from "../lib/prompts";
import { getStationMeta, patientFilePath } from "./stationsService";
import {
  detectCaregiverFindingLeaks,
  detectPatientFindingLeaks,
} from "@shared/patientLeakDetection";

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
  sex: PatientSex;
  age?: number;
  interlocutor: Interlocutor;
  stationType?: string;   // inféré par stationsService, optionnel pour rétrocompat tests
}

// "Feuille de porte" + phrase d'ouverture — tout ce dont l'UI a besoin côté étudiant :
// elle peut afficher les signes vitaux / cadre / description sans faire d'appel LLM.
// Aucune donnée de scoring ni script anamnèse complet n'est renvoyée.
// `sex` est déduit de `patient_description` par extractSex (cache mémoire).
// `stationType` est repris depuis le catalog (inférence déterministe au boot).
export async function getPatientBrief(stationId: string): Promise<PatientBrief> {
  const station = await getPatientStation(stationId);
  const patientDescription = station.patient_description ?? "";
  const sex = extractSex(patientDescription);
  const age = extractAge(station.age, patientDescription);
  const interlocutor = resolveInterlocutor({ patientDescription, age, sex });
  const meta = getStationMeta(stationId);
  return {
    stationId,
    setting: station.setting ?? "",
    patientDescription,
    vitals: station.vitals ?? {},
    phraseOuverture: station.ouverture ?? station.phrase_ouverture ?? "",
    phraseOuvertureComplement: station.ouverture_complement ?? station.phrase_ouverture_complement,
    sex,
    age,
    interlocutor,
    stationType: meta?.stationType,
  };
}

// Directive additionnelle injectée quand l'étudiant interagit au clavier plutôt qu'à la voix.
const TEXT_MODE_DIRECTIVE = `

## ADAPTATION
La conversation se déroule en mode texte, pas en mode vocal. Tu peux répondre avec des phrases légèrement plus construites, mais reste naturel et bref.`;

// Directive injectée quand l'interlocuteur est un parent présent à côté d'un
// patient qui parle (enfant en âge scolaire). Le patient parle, le parent peut
// compléter. Le cas `type === "parent"` est géré via un prompt dédié
// (`caregiver.md`), pas via une directive additive.
function interlocutorDirective(interlocutor: Interlocutor): string {
  if (interlocutor.type === "self" && interlocutor.parentPresent) {
    return `

## CONTEXTE D'INTERLOCUTION
Un parent est présent dans la pièce. Tu réponds toi-même aux questions du médecin (tu es le patient, un enfant en âge scolaire), mais le parent peut intervenir brièvement pour préciser des éléments factuels (dates, antécédents, chronologie) si tu hésites. Reste en personnage ; c'est à toi de parler en priorité.`;
  }
  return "";
}

// Bloc d'identification du patient injecté dans le prompt caregiver : même
// valeur logique que l'ancienne directive "le patient est X", mais consommé par
// caregiver.md qui a son propre registre naïf.
function caregiverIdentityBlock(
  interlocutor: Interlocutor,
  station: any,
): string {
  const role =
    interlocutor.parentRole === "mother" ? "la mère" :
    interlocutor.parentRole === "father" ? "le père" :
    "l'accompagnant·e";
  const patientName = station.nom ?? "le patient";
  const age = station.age ? ` (${station.age})` : "";
  return `

## PATIENT DONT TU ES L'ACCOMPAGNANT·E
Tu es ${role} de ${patientName}${age}. Toutes les règles du prompt s'appliquent en te nommant toi comme interlocuteur du médecin, pas le patient.`;
}

// Résout l'interlocuteur effectif pour une station (parent vs self), en
// factorisant la logique partagée entre buildSystemPrompt (prompt routing) et
// runPatientChat / streamPatientChat (leak detection post-génération).
export async function resolveStationInterlocutor(
  stationId: string,
): Promise<{ station: any; interlocutor: Interlocutor }> {
  const station = await getPatientStation(stationId);
  const patientDescription = station.patient_description ?? "";
  const sex = extractSex(patientDescription);
  const age = extractAge(station.age, patientDescription);
  const interlocutor = resolveInterlocutor({ patientDescription, age, sex });
  return { station, interlocutor };
}

// Construit le system prompt complet : markdown + bloc <station_data>.
// Quand l'interlocuteur est un parent/accompagnant, on charge `caregiver.md`
// au lieu de `patient.md` — le caregiver prompt a son propre registre naïf
// non-médical, sa propre blacklist élargie (verbes de mesure instrumentale,
// jargon soignant) et ses propres few-shots. Le cas `self + parent présent`
// reste sur patient.md + une directive additive.
export async function buildSystemPrompt(
  stationId: string,
  mode: "voice" | "text",
): Promise<string> {
  const { station, interlocutor } = await resolveStationInterlocutor(stationId);
  const useCaregiverPrompt = interlocutor.type === "parent";
  const template = await loadPrompt(useCaregiverPrompt ? "caregiver" : "patient");
  const identityBlock = useCaregiverPrompt
    ? caregiverIdentityBlock(interlocutor, station)
    : interlocutorDirective(interlocutor);

  const dataBlock = `\n\n<station_data>\n${JSON.stringify(station, null, 2)}\n</station_data>`;
  const modeDirective = mode === "text" ? TEXT_MODE_DIRECTIVE : "";
  return template + identityBlock + modeDirective + dataBlock;
}

// Détecte les leaks de findings objectifs dans la réponse LLM POST-génération.
// Mode log-only : on émet une ligne JSON structurée dans stdout (picked up par
// /var/log/* ou l'agrégateur Replit), on ne bloque pas la conversation. Sert
// de télémétrie pour renforcer le prompt ou passer en mode sanitize plus tard.
// Respecte l'invariant 3 ECOS : jamais d'invention — ici on détecte la sortie
// suspecte sans la censurer, pour ne pas briser l'expérience sur un faux
// positif tant que la liste n'est pas 100% stabilisée.
function logLeaksIfAny(
  stationId: string,
  interlocutorType: Interlocutor["type"],
  reply: string,
): void {
  if (!reply) return;
  const leaks = interlocutorType === "parent"
    ? detectCaregiverFindingLeaks(reply)
    : detectPatientFindingLeaks(reply);
  if (leaks.length === 0) return;
  // eslint-disable-next-line no-console
  console.info(JSON.stringify({
    event: "patient_response_leak",
    stationId,
    interlocutor: interlocutorType,
    leaks,
  }));
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

  const { interlocutor } = await resolveStationInterlocutor(opts.stationId);
  const system = await buildSystemPrompt(opts.stationId, opts.mode);
  const client = new OpenAI({ apiKey: key });
  const model = opts.model ?? "gpt-4o-mini";
  const started = Date.now();
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.7,
      max_tokens: 400,
      messages: [
        { role: "system", content: system },
        ...opts.history,
        { role: "user", content: opts.userMessage },
      ],
    });
    const reply = completion.choices[0]?.message?.content?.trim() ?? "";
    logLeaksIfAny(opts.stationId, interlocutor.type, reply);
    void logRequest({
      route: "/api/patient/chat",
      stationId: opts.stationId,
      model,
      tokensIn: completion.usage?.prompt_tokens ?? 0,
      tokensOut: completion.usage?.completion_tokens ?? 0,
      cachedTokens: 0,
      latencyMs: Date.now() - started,
      ok: true,
    });
    return reply;
  } catch (err) {
    void logRequest({
      route: "/api/patient/chat",
      stationId: opts.stationId,
      model,
      tokensIn: 0,
      tokensOut: 0,
      cachedTokens: 0,
      latencyMs: Date.now() - started,
      ok: false,
    });
    throw err;
  }
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
// `signal` permet à la route d'abort l'appel OpenAI si le client se déconnecte.
export async function* streamPatientChat(
  opts: ChatOptions,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const key = getOpenAIKey();
  if (!key) throw new Error("OPENAI_API_KEY_MISSING");

  const { interlocutor } = await resolveStationInterlocutor(opts.stationId);
  const system = await buildSystemPrompt(opts.stationId, opts.mode);
  const client = new OpenAI({ apiKey: key });
  const model = opts.model ?? "gpt-4o-mini";
  const started = Date.now();

  const stream = await client.chat.completions.create(
    {
      model,
      temperature: 0.7,
      max_tokens: 400,
      stream: true,
      // include_usage : OpenAI n'envoie le bloc usage qu'en fin de stream si on le demande.
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: system },
        ...opts.history,
        { role: "user", content: opts.userMessage },
      ],
    },
    { signal },
  );

  let fullText = "";
  let pending = "";
  let sentenceIndex = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let ok = true;

  try {
    for await (const chunk of stream) {
      // Le dernier chunk peut n'avoir que `usage` sans choices[0].delta.
      if ((chunk as any).usage) {
        tokensIn = (chunk as any).usage.prompt_tokens ?? 0;
        tokensOut = (chunk as any).usage.completion_tokens ?? 0;
      }
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
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
    logLeaksIfAny(opts.stationId, interlocutor.type, fullText);
    yield { type: "done", fullText: fullText.trim() };
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    void logRequest({
      route: "/api/patient/chat/stream",
      stationId: opts.stationId,
      model,
      tokensIn,
      tokensOut,
      cachedTokens: 0,
      latencyMs: Date.now() - started,
      ok,
    });
  }
}
