// Phase 5 J2 — route HTTP de l'évaluateur médico-légal heuristique.
//
// POST /api/evaluation/legal
//   Body  : { stationId: string, transcript: string }
//   200   : LegalEvaluation (cf. legalEvaluator.ts)
//   400   : station inconnue OU station sans legalContext OU body invalide
//
// Endpoint isolé : ne touche pas /api/evaluator/evaluate (Phase 2/3).
// ZÉRO appel LLM ici (la chaîne d'appel reste 100 % déterministe).

import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { sendApiError } from "../lib/errors";
import {
  evaluateLegal,
  LegalEvaluatorNoLegalContextError,
  LegalEvaluatorStationNotFoundError,
} from "../services/legalEvaluator";

const router = Router();

const LegalEvaluateBody = z.object({
  stationId: z.string().min(1),
  // On accepte une chaîne libre (transcription concaténée). Les
  // formats riches (tableau de tours, JSON par locuteur, …) seront
  // sérialisés côté client pour être passés ici. Limite haute à
  // 200 000 caractères pour éviter les abus mémoire ; un OSCE
  // typique tient en < 50 000 caractères de transcription.
  transcript: z.string().max(200_000),
});

router.post("/legal", async (req: Request, res: Response) => {
  const parsed = LegalEvaluateBody.safeParse(req.body);
  if (!parsed.success) {
    return sendApiError(
      res,
      "bad_request",
      "Payload /evaluation/legal invalide.",
      parsed.error.issues[0]?.message,
    );
  }
  try {
    const result = await evaluateLegal(parsed.data);
    return res.json(result);
  } catch (err) {
    if (err instanceof LegalEvaluatorStationNotFoundError) {
      return sendApiError(res, "bad_request", err.message);
    }
    if (err instanceof LegalEvaluatorNoLegalContextError) {
      return sendApiError(
        res,
        "bad_request",
        err.message,
        "Cette station ne porte pas de qualification médico-légale (legalContext absent).",
      );
    }
    return sendApiError(
      res,
      "internal_error",
      "Erreur inattendue dans l'évaluateur médico-légal.",
      (err as Error).message,
    );
  }
});

export default router;
