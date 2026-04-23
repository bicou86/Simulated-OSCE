// Route publique : liste des stations pour la Bibliothèque.

import { Router, type Request, type Response } from "express";
import { countByStationType, getStationMeta, listStations } from "../services/stationsService";

const router = Router();

// GET /api/stations → liste complète (métadonnées uniquement + station_type inféré).
router.get("/", (_req: Request, res: Response) => {
  const stations = listStations().map((s) => ({
    id: s.id,
    title: s.title,
    source: s.source,
    setting: s.setting,
    stationType: s.stationType,
  }));
  res.json({ stations, total: stations.length });
});

// GET /api/stations/types/summary → répartition count(*) par station_type.
// Endpoint d'audit pour vérifier que les 6 règles d'inférence ne dérivent pas.
router.get("/types/summary", (_req: Request, res: Response) => {
  const counts = countByStationType();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  res.json({ counts, total });
});

// GET /api/stations/:id → métadonnées d'une station précise.
router.get("/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const meta = getStationMeta(id);
  if (!meta) {
    return res.status(404).json({
      error: `Station ${id} introuvable.`,
      code: "not_found",
    });
  }
  res.json({
    id: meta.id,
    title: meta.title,
    source: meta.source,
    setting: meta.setting,
    stationType: meta.stationType,
    stationTypeMatchedRule: meta.stationTypeMatchedRule,
  });
});

export default router;
