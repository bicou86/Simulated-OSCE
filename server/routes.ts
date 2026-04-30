import type { Express, Request, Response } from "express";
import { type Server } from "http";

import { loadConfig } from "./lib/config";
import { initCatalog } from "./services/stationsService";
import adminRouter from "./routes/admin";
import settingsRouter from "./routes/settings";
import patientRouter from "./routes/patient";
import evaluatorRouter from "./routes/evaluator";
import evaluationRouter from "./routes/evaluation";
import examinerRouter from "./routes/examiner";
import stationsRouter from "./routes/stations";
import debugRouter from "./routes/debug";

// Monte tous les routers API + un garde 404 JSON. Source de vérité unique :
// `registerRoutes` (runtime) et `buildTestApp` (tests) utilisent tous deux
// cette fonction — impossible d'oublier un routeur dans un contexte et pas
// l'autre, et le garde 404 JSON garantit que /api/* ne tombe JAMAIS dans le
// catch-all SPA qui renvoie du HTML.
//
// ─── ORDRE DE MOUNT (critique) ─────────────────────────────────────────
// 1. Tous les routers `/api/<resource>` (dans n'importe quel ordre entre eux,
//    Express matche par préfixe distinct).
// 2. Le garde 404 JSON `/api` doit être DERNIER — il intercepte tout `/api/*`
//    qui n'a matché aucun router au-dessus (sinon il avalerait les routers
//    montés après lui).
// 3. Le serve-static SPA Vite (server/index.ts) est ajouté APRÈS
//    mountApiRoutes() — ça garantit qu'un `/api/<truc>` non-mappé renvoie
//    JSON 404 plutôt que du HTML SPA (qui faisait échouer JSON.parse côté
//    client avec "Unexpected token '<'" en Phase 1).
//
// ⚠ Pré-requis runtime Replit : `tsx watch` ne hot-reload PAS l'ajout
// d'un nouveau router (cf. Phase 5 J3, 7 J1, 7 J2, 7 J3 — symptôme
// récurrent). Toute modif ajoutant/retirant un app.use() ci-dessous
// nécessite un kill complet du process avant les tests runtime UI.
export function mountApiRoutes(app: Express): void {
  app.use("/api/stations", stationsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/patient", patientRouter);
  app.use("/api/examiner", examinerRouter);
  app.use("/api/evaluator", evaluatorRouter);
  app.use("/api/evaluation", evaluationRouter);
  app.use("/api/admin", adminRouter);
  // Phase 7 J3 — debug-only routes. Garde NODE_ENV interne : router
  // monté en permanence (les tests doivent pouvoir l'invoquer), mais
  // les handlers eux-mêmes 404 hors dev. Voir server/routes/debug.ts.
  app.use("/api/debug", debugRouter);

  // Defense-in-depth : tout /api/* qui n'a pas matché un router enregistré
  // renvoie un JSON 404 explicite plutôt que tomber dans le catch-all Vite/SPA
  // (qui retournerait index.html avec Content-Type text/html, faisant échouer
  // le JSON.parse côté client avec un message cryptique "Unexpected token '<'").
  app.use("/api", (req: Request, res: Response) => {
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.originalUrl}`,
      code: "not_found",
    });
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // Charge les clés API en mémoire (process.env + .env.local).
  await loadConfig();

  // Parse l'ensemble des JSON de stations et construit le catalogue en mémoire.
  await initCatalog();

  mountApiRoutes(app);

  return httpServer;
}
