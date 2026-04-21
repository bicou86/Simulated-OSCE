// Service Évaluateur — isolation stricte des données examinateur.
// N'accède JAMAIS aux fichiers Patient_*.json.
// Charge la grille à la demande, cache le prompt via Anthropic `cache_control: ephemeral`.

import { promises as fs } from "fs";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { getAnthropicKey } from "../lib/config";
import { loadPrompt } from "../lib/prompts";
import { evaluatorFilePath, getStationMeta } from "./stationsService";

const fileCache = new Map<string, any[]>();

async function loadFile(filename: string): Promise<any[]> {
  const cached = fileCache.get(filename);
  if (cached) return cached;
  const content = await fs.readFile(evaluatorFilePath(filename), "utf-8");
  const parsed = JSON.parse(content) as { stations: any[] };
  fileCache.set(filename, parsed.stations);
  return parsed.stations;
}

export class EvaluatorStationNotFoundError extends Error {
  constructor(public readonly stationId: string) {
    super(`Grille examinateur introuvable pour ${stationId}.`);
    this.name = "EvaluatorStationNotFoundError";
  }
}

export async function getEvaluatorStation(stationId: string): Promise<any> {
  const meta = getStationMeta(stationId);
  if (!meta) throw new EvaluatorStationNotFoundError(stationId);
  const stations = await loadFile(meta.evaluatorFile);
  const station = stations[meta.indexInFile];
  if (!station || station.id !== meta.fullId) {
    const fallback = stations.find((s) => s.id === meta.fullId);
    if (!fallback) throw new EvaluatorStationNotFoundError(stationId);
    return fallback;
  }
  return station;
}

// ─────────── Contrat de sortie duale ───────────

export const EvaluationScores = z.object({
  globalScore: z.number().int().min(0).max(100),
  sections: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      weight: z.number(),
      score: z.number().int().min(0).max(100),
      raw: z.string().optional(),
    }),
  ),
  verdict: z.enum(["Réussi", "À retravailler", "Échec"]),
});
export type EvaluationScores = z.infer<typeof EvaluationScores>;

export interface EvaluationResult {
  markdown: string;
  scores: EvaluationScores;
}

// Extrait le JSON scores du bloc <scores_json>…</scores_json> en fin de message.
function splitReport(raw: string): { markdown: string; scoresRaw: string | null } {
  const match = raw.match(/<scores_json>([\s\S]*?)<\/scores_json>/i);
  if (!match) {
    return { markdown: raw.trim(), scoresRaw: null };
  }
  const markdown = raw.slice(0, match.index).trim();
  return { markdown, scoresRaw: match[1].trim() };
}

function formatTranscript(items: Array<{ role: "patient" | "doctor"; text: string }>): string {
  return items
    .map((m) => `${m.role === "doctor" ? "Médecin" : "Patient"} : ${m.text}`)
    .join("\n");
}

export interface EvaluateOptions {
  stationId: string;
  transcript: Array<{ role: "patient" | "doctor"; text: string }>;
  model?: string;
}

export async function runEvaluation(opts: EvaluateOptions): Promise<EvaluationResult> {
  const key = getAnthropicKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY_MISSING");

  const [promptTemplate, station] = await Promise.all([
    loadPrompt("evaluator"),
    getEvaluatorStation(opts.stationId),
  ]);

  const stationBlock = `\n\n<station_data>\n${JSON.stringify(station, null, 2)}\n</station_data>`;
  const systemBlocks: Anthropic.TextBlockParam[] = [
    // Bloc 1 : prompt markdown, stable entre toutes les évaluations → mise en cache agressive.
    {
      type: "text",
      text: promptTemplate,
      cache_control: { type: "ephemeral" },
    },
    // Bloc 2 : données de la station. Plus petit, spécifique — pas besoin de cache explicite.
    {
      type: "text",
      text: stationBlock,
    },
  ];

  const userMessage = [
    `Station ${opts.stationId}.`,
    "",
    "TRANSCRIPTION :",
    formatTranscript(opts.transcript),
    "",
    "Évaluation",
  ].join("\n");

  const client = new Anthropic({ apiKey: key });
  const msg = await client.messages.create({
    model: opts.model ?? "claude-sonnet-4-5",
    max_tokens: 6000,
    system: systemBlocks,
    messages: [{ role: "user", content: userMessage }],
  });

  // Observabilité : trace la consommation tokens et le stop_reason pour diagnostiquer
  // les troncatures éventuelles et vérifier les cache-hits.
  // eslint-disable-next-line no-console
  console.log(
    `[evaluator] station=${opts.stationId} stop=${msg.stop_reason} ` +
      `in=${msg.usage.input_tokens} out=${msg.usage.output_tokens} ` +
      `cache_created=${msg.usage.cache_creation_input_tokens ?? 0} ` +
      `cache_read=${msg.usage.cache_read_input_tokens ?? 0}`,
  );

  const raw = msg.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const { markdown, scoresRaw } = splitReport(raw);

  if (!scoresRaw) {
    throw new EvaluatorOutputError(
      "Le bloc <scores_json> attendu est absent de la réponse.",
      raw,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(scoresRaw);
  } catch (err) {
    throw new EvaluatorOutputError(
      `Bloc <scores_json> non JSON : ${(err as Error).message}`,
      scoresRaw,
    );
  }
  const validated = EvaluationScores.safeParse(parsed);
  if (!validated.success) {
    throw new EvaluatorOutputError(
      `Schéma <scores_json> invalide : ${validated.error.issues[0]?.message}`,
      scoresRaw,
    );
  }

  return { markdown, scores: validated.data };
}

export class EvaluatorOutputError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
    this.name = "EvaluatorOutputError";
  }
}
