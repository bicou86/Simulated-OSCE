// Service Évaluateur — isolation stricte des données examinateur.
// N'accède JAMAIS aux fichiers Patient_*.json.
// Charge la grille à la demande, cache le prompt via Anthropic `cache_control: ephemeral`.

import { promises as fs } from "fs";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { getAnthropicKey } from "../lib/config";
import { logRequest } from "../lib/logger";
import { loadPrompt } from "../lib/prompts";
import { evaluatorFilePath, getStationMeta } from "./stationsService";
import {
  getAxisWeights,
  type StationType,
} from "../../shared/evaluation-weights";

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
  stationType?: StationType;
  communicationWeight?: number;
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

  const meta = getStationMeta(opts.stationId);
  const stationType: StationType | undefined = meta?.stationType;
  const axisWeights = stationType ? getAxisWeights(stationType) : undefined;
  const communicationWeight = axisWeights?.communication ?? 0;

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

  // Phase 2 — injection explicite du station_type inféré + des poids de l'axe
  // Communication, pour que Sonnet n'ait pas à deviner l'importance
  // pédagogique. On passe le poids en pourcentage (cf. shared/evaluation-
  // weights.ts), cohérent avec le format `weight` 0-1 attendu en sortie ⇒
  // Sonnet divise par 100.
  const phase2Block = stationType && axisWeights
    ? [
        "",
        "PHASE 2 — station_type :",
        `  type inféré : ${stationType}`,
        `  poids canoniques de cette station (en %) :`,
        `    anamnese=${axisWeights.anamnese}  examen=${axisWeights.examen}  ` +
          `management=${axisWeights.management}  cloture=${axisWeights.cloture}  ` +
          `communication=${axisWeights.communication}`,
        "  Utilise ces poids pour l'axe COMMUNICATION (exprime weight en fraction, ex. 0.40 pour 40%).",
        "  Conserve le comportement existant pour les 4 axes classiques (anamnèse, examen,",
        "  management, clôture) : leurs poids viennent toujours du champ `weights` de",
        `  <station_data>. L'axe Communication est additif — si weight=0, produis quand même`,
        "  la ligne dans sections[] avec score observé, elle sera exclue du globalScore.",
        "",
      ].join("\n")
    : "";

  const userMessage = [
    `Station ${opts.stationId}.`,
    "",
    phase2Block,
    "TRANSCRIPTION :",
    formatTranscript(opts.transcript),
    "",
    "Évaluation",
  ].join("\n");

  const client = new Anthropic({ apiKey: key });
  const model = opts.model ?? "claude-sonnet-4-5";
  const started = Date.now();
  let msg: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    msg = await client.messages.create({
      model,
      max_tokens: 6000,
      system: systemBlocks,
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    void logRequest({
      route: "/api/evaluator/evaluate",
      stationId: opts.stationId,
      model,
      tokensIn: 0, tokensOut: 0, cachedTokens: 0,
      latencyMs: Date.now() - started,
      ok: false,
    });
    throw err;
  }

  // Observabilité : trace la consommation tokens et le stop_reason pour diagnostiquer
  // les troncatures éventuelles et vérifier les cache-hits.
  // eslint-disable-next-line no-console
  console.log(
    `[evaluator] station=${opts.stationId} stop=${msg.stop_reason} ` +
      `in=${msg.usage.input_tokens} out=${msg.usage.output_tokens} ` +
      `cache_created=${msg.usage.cache_creation_input_tokens ?? 0} ` +
      `cache_read=${msg.usage.cache_read_input_tokens ?? 0}`,
  );

  void logRequest({
    route: "/api/evaluator/evaluate",
    stationId: opts.stationId,
    model,
    tokensIn: msg.usage.input_tokens ?? 0,
    tokensOut: msg.usage.output_tokens ?? 0,
    cachedTokens: msg.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
    latencyMs: Date.now() - started,
    ok: true,
  });

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

  // Phase 2 — override des poids : la table `shared/evaluation-weights.ts`
  // est la source de vérité unique. Sonnet peut halluciner un poids
  // (ex. Communication=0.20 sur anamnese_examen observé en prod), donc
  // on ne lui fait pas confiance ici. On réécrit chaque section.weight à
  // partir de la table canonique, puis on recalcule globalScore en
  // appliquant la formule documentée dans evaluator.md (Σ score×weight /
  // Σ weight>0). Cela garantit que le front affiche toujours des poids
  // cohérents avec /api/evaluator/weights, quel que soit le LLM sous-jacent.
  const scores = axisWeights
    ? normalizeScoresWithCanonicalWeights(validated.data, axisWeights)
    : validated.data;

  return {
    markdown,
    scores,
    stationType,
    communicationWeight,
  };
}

// Réécrit les poids des sections à partir de la table Phase 2 et recalcule
// globalScore. Garde-fou contre l'hallucination LLM (cf. bug B Phase 2).
// Ajoute une ligne Communication avec score 0 si Sonnet ne l'a pas produite.
export function normalizeScoresWithCanonicalWeights(
  scores: EvaluationScores,
  canonical: { anamnese: number; examen: number; management: number; cloture: number; communication: number },
): EvaluationScores {
  const canonicalFraction: Record<string, number> = {
    anamnese: canonical.anamnese / 100,
    examen: canonical.examen / 100,
    management: canonical.management / 100,
    cloture: canonical.cloture / 100,
    communication: canonical.communication / 100,
  };
  const nameByKey: Record<string, string> = {
    anamnese: "Anamnèse",
    examen: "Examen",
    management: "Management",
    cloture: "Clôture",
    communication: "Communication",
  };

  // Indexe les sections produites par Sonnet par clé normalisée.
  const byKey = new Map<string, typeof scores.sections[number]>();
  for (const s of scores.sections) {
    byKey.set(s.key, s);
  }

  // Reconstruit la liste dans l'ordre canonique avec les poids Phase 2.
  // Si une section est absente de la sortie Sonnet, on l'insère avec score=0
  // (pédagogiquement équivalent à « non couvert ») — elle reste affichée au
  // candidat, ce qui est plus transparent qu'un trou silencieux.
  const orderedKeys = ["anamnese", "examen", "management", "cloture", "communication"] as const;
  const sections = orderedKeys.map((key) => {
    const existing = byKey.get(key);
    return {
      key,
      name: existing?.name ?? nameByKey[key],
      weight: canonicalFraction[key],
      score: existing?.score ?? 0,
      ...(existing?.raw ? { raw: existing.raw } : {}),
    };
  });

  // Recalcule globalScore = Σ(score×weight) / Σ(weight>0). Exclut donc les
  // axes à poids nul (ex. Communication sur anamnese_examen).
  const weightedSum = sections.reduce((acc, s) => acc + s.score * s.weight, 0);
  const totalWeight = sections.reduce((acc, s) => acc + (s.weight > 0 ? s.weight : 0), 0);
  const globalScore = totalWeight === 0 ? 0 : Math.round(weightedSum / totalWeight);

  return {
    ...scores,
    sections,
    globalScore,
  };
}

export class EvaluatorOutputError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
    this.name = "EvaluatorOutputError";
  }
}
