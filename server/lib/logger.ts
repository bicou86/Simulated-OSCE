// JSONL request logger — observabilité consommation tokens / coûts.
// Append-only vers server/logs/requests.jsonl ; jamais bloquant, jamais fatal.
//
// Chaque ligne = 1 appel LLM (chat streaming inclus), avec tokens + latence + coût estimé.
// Consommé par /api/admin/stats pour agréger par jour / route / modèle.

import { promises as fs } from "fs";
import path from "path";

// Emplacement fixé relativement à server/ pour éviter les surprises de cwd en prod.
const LOG_DIR = path.resolve(process.cwd(), "server/logs");
const LOG_FILE = path.join(LOG_DIR, "requests.jsonl");

// Tarifs publics (USD) au 2026-04-22. Unités : $/1M tokens sauf mention.
// À actualiser lors d'une bascule de modèle — garder en sync avec la doc fournisseur.
const PRICING = {
  "gpt-4o-mini": { inPerM: 0.15, outPerM: 0.60, cachedInPerM: 0.075 },
  "gpt-4o": { inPerM: 2.50, outPerM: 10.00, cachedInPerM: 1.25 },
  "whisper-1": { perMinute: 0.006 },
  "tts-1": { perMillionChars: 15.00 },
  "claude-sonnet-4-5": { inPerM: 3.00, outPerM: 15.00, cachedInPerM: 0.30, cacheWritePerM: 3.75 },
  "claude-opus-4-7": { inPerM: 15.00, outPerM: 75.00, cachedInPerM: 1.50, cacheWritePerM: 18.75 },
} as const;

export type ModelName = keyof typeof PRICING;

export interface LogEntry {
  ts: string;                // ISO-8601
  route: string;             // "/api/patient/chat", etc.
  stationId?: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;      // lus depuis le cache Anthropic (ne compte pas comme tokensIn)
  cacheWriteTokens?: number; // cache_creation_input_tokens (Anthropic)
  latencyMs: number;
  costUsd: number;
  ok: boolean;
  // Pour STT/TTS où le coût ne dépend pas des tokens.
  durationSec?: number;      // Whisper
  charCount?: number;        // TTS
}

export interface CostInput {
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  durationSec?: number;
  charCount?: number;
}

// Calcule un coût estimé en USD. Renvoie 0 pour les modèles inconnus plutôt que throw —
// la télémétrie n'a pas vocation à casser le chemin applicatif.
export function estimateCost(input: CostInput): number {
  const p = (PRICING as any)[input.model];
  if (!p) return 0;

  if ("inPerM" in p) {
    const billableIn = Math.max(0, (input.tokensIn ?? 0) - (input.cachedTokens ?? 0));
    const inCost = (billableIn / 1_000_000) * p.inPerM;
    const outCost = ((input.tokensOut ?? 0) / 1_000_000) * p.outPerM;
    const cachedCost = ((input.cachedTokens ?? 0) / 1_000_000) * (p.cachedInPerM ?? 0);
    const cacheWriteCost = ((input.cacheWriteTokens ?? 0) / 1_000_000) * (p.cacheWritePerM ?? 0);
    return inCost + outCost + cachedCost + cacheWriteCost;
  }
  if ("perMinute" in p) {
    return ((input.durationSec ?? 0) / 60) * p.perMinute;
  }
  if ("perMillionChars" in p) {
    return ((input.charCount ?? 0) / 1_000_000) * p.perMillionChars;
  }
  return 0;
}

let ensuredDir = false;
async function ensureDir(): Promise<void> {
  if (ensuredDir) return;
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    ensuredDir = true;
  } catch { /* best-effort ; catch silencieusement */ }
}

// Écrit une ligne JSONL. Fire-and-forget ; jamais attendu par le chemin chaud.
export async function logRequest(entry: Omit<LogEntry, "costUsd" | "ts"> & { costUsd?: number }): Promise<void> {
  try {
    await ensureDir();
    const full: LogEntry = {
      ts: new Date().toISOString(),
      costUsd: entry.costUsd ?? estimateCost(entry),
      ...entry,
    } as LogEntry;
    await fs.appendFile(LOG_FILE, JSON.stringify(full) + "\n", { encoding: "utf-8" });
  } catch { /* logger ne doit jamais casser l'appel */ }
}

// Lecture du JSONL pour l'agrégation. Renvoie [] si le fichier n'existe pas.
export async function readLog(): Promise<LogEntry[]> {
  try {
    const content = await fs.readFile(LOG_FILE, "utf-8");
    const out: LogEntry[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { out.push(JSON.parse(trimmed) as LogEntry); } catch { /* ligne corrompue, skip */ }
    }
    return out;
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

// Expose le chemin pour les tests (override via process.env si besoin).
export const LOG_PATHS = { dir: LOG_DIR, file: LOG_FILE };
