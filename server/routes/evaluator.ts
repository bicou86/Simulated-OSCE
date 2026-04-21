// Route POST /api/evaluator/evaluate
// Envoie transcript + scénario à Claude Sonnet 4.5, renvoie un rapport JSON strict.

import { Router, type Request, type Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { getAnthropicKey } from "../lib/config";
import { loadPrompt } from "../lib/prompts";
import { sendApiError, sendUpstreamError } from "../lib/errors";

const router = Router();

const EvaluateBody = z.object({
  station: z.object({
    scenario: z.string(),
    title: z.string().optional(),
    specialty: z.string().optional(),
  }),
  transcript: z.array(
    z.object({
      role: z.enum(["patient", "doctor"]),
      text: z.string(),
    }),
  ),
});

// Contrat de sortie attendu de la part de Claude (aligné avec evaluator.md).
const EvaluationReport = z.object({
  globalScore: z.number().int().min(0).max(100),
  anamnese: z.number().int().min(0).max(100),
  examen: z.number().int().min(0).max(100),
  communication: z.number().int().min(0).max(100),
  diagnostic: z.number().int().min(0).max(100),
  strengths: z.array(z.string()),
  criticalOmissions: z.array(z.string()),
  priorities: z.array(z.string()),
  verdict: z.enum(["Réussi", "À retravailler", "Échec"]),
});

export type EvaluationReport = z.infer<typeof EvaluationReport>;

function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

function formatTranscript(items: Array<{ role: "patient" | "doctor"; text: string }>): string {
  return items
    .map((m) => `${m.role === "doctor" ? "Étudiant" : "Patient"}: ${m.text}`)
    .join("\n");
}

// Extrait un objet JSON d'une réponse texte, même si Claude a enveloppé dans ```json … ```.
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

router.post("/evaluate", async (req: Request, res: Response) => {
  const parsed = EvaluateBody.safeParse(req.body);
  if (!parsed.success) {
    return sendApiError(
      res,
      "bad_request",
      "Payload /evaluate invalide.",
      parsed.error.issues[0]?.message,
    );
  }

  const key = getAnthropicKey();
  if (!key) {
    return sendApiError(
      res,
      "not_configured",
      "Clé Anthropic manquante.",
      "Ouvrez Paramètres et renseignez votre clé sk-ant-…",
    );
  }

  try {
    const template = await loadPrompt("evaluator");
    const rendered = renderPrompt(template, {
      scenario: parsed.data.station.scenario,
      transcript: formatTranscript(parsed.data.transcript),
    });

    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      system:
        "Tu es un examinateur OSCE. Ne réponds QUE par un objet JSON conforme au schéma fourni dans le message utilisateur. Aucun texte hors JSON, aucun ```.",
      messages: [{ role: "user", content: rendered }],
    });

    // On agrège les blocs texte de la réponse (Claude peut en produire plusieurs).
    const rawText = msg.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    let jsonValue: unknown;
    try {
      jsonValue = extractJson(rawText);
    } catch {
      return sendApiError(
        res,
        "upstream_error",
        "Réponse non JSON du modèle évaluateur.",
        "Réessayez ; si le problème persiste, réduire la taille du transcript.",
      );
    }

    const report = EvaluationReport.safeParse(jsonValue);
    if (!report.success) {
      return sendApiError(
        res,
        "upstream_error",
        "Le rapport JSON ne respecte pas le schéma attendu.",
        report.error.issues[0]?.message,
      );
    }

    return res.json(report.data);
  } catch (err) {
    return sendUpstreamError(res, err);
  }
});

export default router;
