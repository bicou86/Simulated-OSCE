// Route HTTP "examinateur" — renvoie un finding d'examen physique pré-scripté
// à partir d'une requête du candidat. Aucune logique LLM : c'est un lookup
// déterministe dans le champ `examen_resultats` de la station patient.

import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { sendApiError } from "../lib/errors";
import { lookupExaminer, StationNotFoundError } from "../services/examinerService";
import { lookupLabs } from "../services/labsService";

const router = Router();

const LookupBody = z.object({
  stationId: z.string().min(1),
  query: z.string().min(1).max(2000),
});

router.post("/lookup", async (req: Request, res: Response) => {
  const parsed = LookupBody.safeParse(req.body);
  if (!parsed.success) {
    return sendApiError(
      res,
      "bad_request",
      "Payload /examiner/lookup invalide.",
      parsed.error.issues[0]?.message,
    );
  }
  try {
    const result = await lookupExaminer(parsed.data.stationId, parsed.data.query);
    return res.json(result);
  } catch (err) {
    if (err instanceof StationNotFoundError) {
      return sendApiError(res, "bad_request", err.message);
    }
    return sendApiError(res, "internal_error", (err as Error).message);
  }
});

// Phase 3 J2 — route labs. Même shape de payload que /lookup, mais le service
// lit `examens_complementaires[lab_key]` plutôt que `examen_resultats` et
// résout le résultat avec LAB_DEFINITIONS (normes, flags, sources cliniques).
router.post("/labs", async (req: Request, res: Response) => {
  const parsed = LookupBody.safeParse(req.body);
  if (!parsed.success) {
    return sendApiError(
      res,
      "bad_request",
      "Payload /examiner/labs invalide.",
      parsed.error.issues[0]?.message,
    );
  }
  try {
    const result = await lookupLabs(parsed.data.stationId, parsed.data.query);
    return res.json(result);
  } catch (err) {
    if (err instanceof StationNotFoundError) {
      return sendApiError(res, "bad_request", err.message);
    }
    return sendApiError(res, "internal_error", (err as Error).message);
  }
});

export default router;
