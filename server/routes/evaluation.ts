// Phase 5 J2 — route HTTP de l'évaluateur médico-légal heuristique.
//
// POST /api/evaluation/legal
//   Body  : { stationId: string, transcript: string }
//   200   : LegalEvaluation (cf. legalEvaluator.ts)
//   400   : station inconnue OU station sans legalContext OU body invalide
//
// Phase 8 J3 — route HTTP de l'évaluateur partie 2 (présentation orale).
//
// POST /api/evaluation/presentation
//   Body  : { stationId: string, transcript: string }
//   200   : PresentationEvaluation (cf. presentationEvaluator.ts)
//   400   : body invalide OU station sans parentStationId (= pas une partie 2)
//   404   : station inconnue (catalog)
//
// Endpoint isolé : ne touche pas /api/evaluator/evaluate (Phase 2/3) ni
// /api/evaluation/legal (Phase 5). ZÉRO appel LLM ici.

import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { sendApiError } from "../lib/errors";
import {
  evaluateLegal,
  LegalEvaluatorNoLegalContextError,
  LegalEvaluatorStationNotFoundError,
} from "../services/legalEvaluator";
import {
  evaluatePresentation,
  PresentationEvaluatorMissingGrilleError,
  PresentationEvaluatorNotPart2Error,
  PresentationEvaluatorStationNotFoundError,
} from "../services/presentationEvaluator";

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

// Phase 8 J3 — POST /api/evaluation/presentation : scoring 4 axes 25 %
// pour les stations partie 2 (présentation orale au spécialiste).
const PresentationEvaluateBody = z.object({
  stationId: z.string().min(1),
  transcript: z.string().min(1).max(200_000),
});

router.post("/presentation", async (req: Request, res: Response) => {
  const parsed = PresentationEvaluateBody.safeParse(req.body);
  if (!parsed.success) {
    return sendApiError(
      res,
      "bad_request",
      "Payload /evaluation/presentation invalide.",
      parsed.error.issues[0]?.message,
    );
  }
  try {
    const result = await evaluatePresentation(parsed.data);
    return res.json(result);
  } catch (err) {
    if (err instanceof PresentationEvaluatorStationNotFoundError) {
      // 404 : station inexistante dans le catalogue. Phase 8 J4 hotfix —
      // « not_found » n'était pas dans ApiErrorCode jusqu'à J4, ce qui
      // faisait que sendApiError écrivait un status undefined et le
      // runtime Replit retournait 500 « Invalid status code: undefined ».
      // Le code « not_found » → 404 est désormais reconnu (cf. errors.ts).
      return sendApiError(res, "not_found", err.message);
    }
    if (err instanceof PresentationEvaluatorNotPart2Error) {
      // 400 : station existe mais n'est pas une partie 2 (parentStationId absent).
      return sendApiError(
        res,
        "bad_request",
        err.message,
        "Endpoint réservé aux stations partie 2 d'une station double (parentStationId requis).",
      );
    }
    if (err instanceof PresentationEvaluatorMissingGrilleError) {
      return sendApiError(
        res,
        "internal_error",
        err.message,
        "La station partie 2 est référencée mais sa grille de scoring est absente côté Examinateur.",
      );
    }
    return sendApiError(
      res,
      "internal_error",
      "Erreur inattendue dans l'évaluateur de présentation orale.",
      (err as Error).message,
    );
  }
});

export default router;
