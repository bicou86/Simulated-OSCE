// Phase 7 J3 — endpoint debug des poids effectifs.
//
// GET /api/debug/evaluation-weights?stationId=X
//
// Réponse JSON :
//   {
//     stationId: string,
//     hasLegalContext: boolean,
//     stationType: StationType,
//     weights: AxisWeights6,            // poids en POINTS (sur 100)
//     sumWeights: number,                // 100 dans les deux modes (preuve)
//   }
//
// Garde de sécurité : 404 en production. C'est un endpoint dev-only,
// destiné à être consommé par l'UI Evaluation J4 pour afficher
// conditionnellement le breakdown 6-axes (présent si legalContext
// actif, absent sinon), et par les vérifs runtime Claude Chrome qui
// veulent observer la pondération sans déclencher une évaluation
// LLM complète. Aucun score, aucun transcript ne fuite — uniquement
// les poids et metadata station.

import { Router, type Request, type Response } from "express";

import { sendApiError } from "../lib/errors";
import { getLegalContext } from "../services/patientService";
import { getStationMeta } from "../services/stationsService";
import { getEffectiveAxisWeights } from "../../shared/evaluation-weights";

const router = Router();

// Garde production : l'endpoint debug ne doit pas exister en prod. On
// renvoie un 404 indistinguable d'une route absente (surface zéro pour
// un observateur externe). Spec J3 : « Tests : station inexistante → 404,
// en mode prod → 404 ».
function send404(res: Response, message: string): Response {
  return res.status(404).json({
    error: message,
    code: "not_found",
  });
}

router.get("/evaluation-weights", async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    return send404(res, "API route not found: GET /api/debug/evaluation-weights");
  }

  const stationId = typeof req.query.stationId === "string" ? req.query.stationId : "";
  if (!stationId) {
    return sendApiError(
      res,
      "bad_request",
      "Paramètre stationId requis (ex. ?stationId=AMBOSS-1).",
    );
  }

  const meta = getStationMeta(stationId);
  if (!meta) {
    return send404(res, `Station inconnue : ${stationId}`);
  }

  // getLegalContext retourne null pour les stations sans legalContext
  // (i.e. la grande majorité du corpus). On ne propage PAS le contenu
  // du legalContext lui-même — uniquement le booléen de présence,
  // pour respecter l'isolation server-only des données médico-légales.
  const ctx = await getLegalContext(stationId).catch(() => null);
  const hasLegalContext = ctx !== null;

  const weights = getEffectiveAxisWeights(meta.stationType, hasLegalContext);
  const sumWeights =
    weights.anamnese +
    weights.examen +
    weights.management +
    weights.cloture +
    weights.communication +
    weights.medico_legal;

  return res.json({
    stationId,
    hasLegalContext,
    stationType: meta.stationType,
    weights,
    sumWeights,
  });
});

export default router;
