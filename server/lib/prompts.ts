// Chargement paresseux + mis en cache des prompts markdown depuis server/prompts/.
// En dev, on relit à chaque requête pour permettre l'itération sans redémarrer.

import { promises as fs } from "fs";
import path from "path";

// Phase 12 Axe B J2 — ancrage via process.cwd() (cf. stationsService.ts
// pour la justification ; bundle ESM rend `import.meta.dirname` peu utile
// pour des chemins relatifs au source).
const PROMPTS_DIR = path.resolve(process.cwd(), "server", "prompts");
const cache = new Map<string, string>();

export async function loadPrompt(name: string): Promise<string> {
  const isDev = process.env.NODE_ENV !== "production";
  if (!isDev && cache.has(name)) {
    return cache.get(name)!;
  }
  const filePath = path.join(PROMPTS_DIR, `${name}.md`);
  const content = await fs.readFile(filePath, "utf-8");
  cache.set(name, content);
  return content;
}
