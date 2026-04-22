// Module de configuration des clés API.
// - Charge depuis process.env au démarrage (le process shell peut les avoir exportées).
// - Charge aussi depuis .env.local s'il existe (persistance optionnelle côté utilisateur).
// - Expose getters / setters en mémoire + persistance explicite vers .env.local.
//
// Les clés ne sont JAMAIS renvoyées au client, seulement des booléens "configuré / valide".

import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";

type ProviderKey = "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "ADMIN_KEY";

const ENV_LOCAL_PATH = path.resolve(process.cwd(), ".env.local");

// État en mémoire (source de vérité pendant le cycle de vie du process).
const state: Record<ProviderKey, string | undefined> = {
  OPENAI_API_KEY: undefined,
  ANTHROPIC_API_KEY: undefined,
  ADMIN_KEY: undefined,
};

// Parseur minimaliste .env : KEY=VALUE par ligne, ignore commentaires et lignes vides.
// Pas d'interpolation, pas de guillemets — on vise simplement des clés d'API opaques.
function parseEnvFile(content: string): Partial<Record<ProviderKey, string>> {
  const out: Partial<Record<ProviderKey, string>> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === "OPENAI_API_KEY" || key === "ANTHROPIC_API_KEY" || key === "ADMIN_KEY") {
      out[key] = value;
    }
  }
  return out;
}

async function readEnvLocal(): Promise<Partial<Record<ProviderKey, string>>> {
  try {
    const content = await fs.readFile(ENV_LOCAL_PATH, "utf-8");
    return parseEnvFile(content);
  } catch (err: any) {
    if (err?.code === "ENOENT") return {};
    throw err;
  }
}

// Écrit .env.local de manière idempotente (crée/remplace uniquement les clés gérées).
async function writeEnvLocal(updates: Partial<Record<ProviderKey, string>>): Promise<void> {
  let existing = "";
  try {
    existing = await fs.readFile(ENV_LOCAL_PATH, "utf-8");
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }

  const lines = existing.split(/\r?\n/);
  const managed = new Set<string>(Object.keys(updates));
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return true;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return true;
    const key = trimmed.slice(0, eq).trim();
    return !managed.has(key);
  });

  // Nettoie les lignes vides en fin de fichier.
  while (filtered.length && filtered[filtered.length - 1].trim() === "") {
    filtered.pop();
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value && value.length > 0) {
      filtered.push(`${key}=${value}`);
    }
  }

  const output = filtered.join("\n") + "\n";
  await fs.writeFile(ENV_LOCAL_PATH, output, { encoding: "utf-8", mode: 0o600 });
}

// Initialisation au démarrage : process.env > .env.local (process.env a la priorité).
// ADMIN_KEY est auto-générée (24 bytes hex) et persistée dans .env.local si absente.
export async function loadConfig(): Promise<void> {
  const fromFile = await readEnvLocal();
  state.OPENAI_API_KEY = process.env.OPENAI_API_KEY || fromFile.OPENAI_API_KEY;
  state.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || fromFile.ANTHROPIC_API_KEY;

  const adminKey = process.env.ADMIN_KEY || fromFile.ADMIN_KEY;
  if (adminKey) {
    state.ADMIN_KEY = adminKey;
  } else {
    const generated = randomBytes(24).toString("hex");
    state.ADMIN_KEY = generated;
    try {
      await writeEnvLocal({ ADMIN_KEY: generated });
      // eslint-disable-next-line no-console
      console.log(`[admin] ADMIN_KEY générée : ${generated}`);
    } catch {
      // Si l'écriture échoue (FS en lecture seule…), on garde la clé en mémoire uniquement
      // — le restart régénérera une nouvelle clé.
      // eslint-disable-next-line no-console
      console.log(`[admin] ADMIN_KEY en mémoire (persist KO) : ${generated}`);
    }
  }
}

export function getAdminKey(): string | undefined {
  return state.ADMIN_KEY;
}

export function getOpenAIKey(): string | undefined {
  return state.OPENAI_API_KEY;
}

export function getAnthropicKey(): string | undefined {
  return state.ANTHROPIC_API_KEY;
}

export interface SetKeysInput {
  openaiKey?: string;
  anthropicKey?: string;
  persist?: boolean; // si true → écrit aussi dans .env.local
}

export async function setKeys(input: SetKeysInput): Promise<void> {
  const updates: Partial<Record<ProviderKey, string>> = {};

  if (typeof input.openaiKey === "string") {
    const trimmed = input.openaiKey.trim();
    state.OPENAI_API_KEY = trimmed.length > 0 ? trimmed : undefined;
    updates.OPENAI_API_KEY = trimmed;
  }
  if (typeof input.anthropicKey === "string") {
    const trimmed = input.anthropicKey.trim();
    state.ANTHROPIC_API_KEY = trimmed.length > 0 ? trimmed : undefined;
    updates.ANTHROPIC_API_KEY = trimmed;
  }

  if (input.persist && Object.keys(updates).length > 0) {
    await writeEnvLocal(updates);
  }
}

// Rapide : vrai si la clé est renseignée avec un format plausible.
// La validation réelle se fait via /api/settings/status (ping en live).
export function isConfigured(provider: "openai" | "anthropic"): boolean {
  const key = provider === "openai" ? state.OPENAI_API_KEY : state.ANTHROPIC_API_KEY;
  if (!key) return false;
  const prefix = provider === "openai" ? "sk-" : "sk-ant-";
  return key.startsWith(prefix) && key.length > prefix.length + 10;
}
