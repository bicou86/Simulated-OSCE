// Routes de gestion des clés API.
// - POST /api/settings         : enregistre les clés (mémoire, + .env.local si persist=true).
// - GET  /api/settings/status  : renvoie { openai_ok, anthropic_ok } via un ping léger.

import { Router, type Request, type Response } from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { getAnthropicKey, getOpenAIKey, isConfigured, setKeys } from "../lib/config";
import { mapUpstreamError, sendApiError } from "../lib/errors";

const router = Router();

const SettingsBody = z.object({
  openaiKey: z.string().optional(),
  anthropicKey: z.string().optional(),
  persist: z.boolean().optional(),
});

router.post("/", async (req: Request, res: Response) => {
  // Phase 12 Axe B J1 — désactivé en production (Replit autoscale +
  // Restricted with password). Le filesystem est volatile entre instances
  // (la persistance .env.local serait perdue à chaque scale), et un
  // utilisateur authentifié par mot de passe partagé ne doit pas pouvoir
  // écraser les clés API du déploiement. Les clés se gèrent via les
  // Replit Secrets (Tools → Secrets : OPENAI_API_KEY, ANTHROPIC_API_KEY).
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({
      error:
        "Configuration des clés API désactivée en production. Utilisez les "
        + "Replit Secrets (onglet Tools → Secrets) pour gérer OPENAI_API_KEY "
        + "et ANTHROPIC_API_KEY.",
    });
  }
  const parsed = SettingsBody.safeParse(req.body);
  if (!parsed.success) {
    return sendApiError(
      res,
      "bad_request",
      "Corps de requête invalide.",
      parsed.error.issues[0]?.message,
    );
  }
  try {
    await setKeys(parsed.data);
    return res.json({
      ok: true,
      persisted: parsed.data.persist === true,
      openaiConfigured: isConfigured("openai"),
      anthropicConfigured: isConfigured("anthropic"),
    });
  } catch (err) {
    return sendApiError(
      res,
      "internal_error",
      "Impossible d'écrire .env.local",
      (err as Error).message,
    );
  }
});

// Ping minimal de chaque fournisseur pour distinguer "clé absente" de "clé invalide".
async function pingOpenAI(): Promise<{ ok: boolean; reason?: string }> {
  const key = getOpenAIKey();
  if (!key) return { ok: false, reason: "not_configured" };
  try {
    const client = new OpenAI({ apiKey: key });
    // `models.list` est léger et ne consomme pas de crédit significatif.
    await client.models.list();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: mapUpstreamError(err).code };
  }
}

async function pingAnthropic(): Promise<{ ok: boolean; reason?: string }> {
  const key = getAnthropicKey();
  if (!key) return { ok: false, reason: "not_configured" };
  try {
    const client = new Anthropic({ apiKey: key });
    // Une requête Messages minimaliste ; max_tokens=1 pour minimiser le coût.
    await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: mapUpstreamError(err).code };
  }
}

router.get("/status", async (_req: Request, res: Response) => {
  const [openai, anthropic] = await Promise.all([pingOpenAI(), pingAnthropic()]);
  res.json({
    openai_ok: openai.ok,
    openai_reason: openai.reason,
    anthropic_ok: anthropic.ok,
    anthropic_reason: anthropic.reason,
  });
});

export default router;
