// Route HTTP "évaluateur" — logique dans evaluatorService.
// POST /api/evaluator/evaluate → { markdown, scores }

import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { getAnthropicKey } from "../lib/config";
import { sendApiError, sendUpstreamError } from "../lib/errors";
import {
  EvaluatorOutputError,
  EvaluatorStationNotFoundError,
  runEvaluation,
} from "../services/evaluatorService";

const router = Router();

const EvaluateBody = z.object({
  stationId: z.string().min(1),
  transcript: z.array(
    z.object({
      role: z.enum(["patient", "doctor"]),
      text: z.string(),
    }),
  ),
  model: z.enum(["claude-sonnet-4-5", "claude-opus-4-7"]).optional(),
});

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
  if (!getAnthropicKey()) {
    return sendApiError(res, "not_configured", "Clé Anthropic manquante.");
  }
  try {
    const result = await runEvaluation(parsed.data);
    return res.json(result);
  } catch (err) {
    if (err instanceof EvaluatorStationNotFoundError) {
      return sendApiError(res, "bad_request", err.message);
    }
    if (err instanceof EvaluatorOutputError) {
      return sendApiError(res, "upstream_error", err.message);
    }
    if ((err as Error).message === "ANTHROPIC_API_KEY_MISSING") {
      return sendApiError(res, "not_configured", "Clé Anthropic manquante.");
    }
    return sendUpstreamError(res, err);
  }
});

export default router;
