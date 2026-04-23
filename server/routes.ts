import type { Express, Request, Response } from "express";
import { type Server } from "http";

import { loadConfig } from "./lib/config";
import { initCatalog } from "./services/stationsService";
import adminRouter from "./routes/admin";
import settingsRouter from "./routes/settings";
import patientRouter from "./routes/patient";
import evaluatorRouter from "./routes/evaluator";
import examinerRouter from "./routes/examiner";
import stationsRouter from "./routes/stations";

// Monte tous les routers API + un garde 404 JSON. Source de vérité unique :
// `registerRoutes` (runtime) et `buildTestApp` (tests) utilisent tous deux
// cette fonction — impossible d'oublier un routeur dans un contexte et pas
// l'autre, et le garde 404 JSON garantit que /api/* ne tombe JAMAIS dans le
// catch-all SPA qui renvoie du HTML.
export function mountApiRoutes(app: Express): void {
  app.use("/api/stations", stationsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/patient", patientRouter);
  app.use("/api/examiner", examinerRouter);
  app.use("/api/evaluator", evaluatorRouter);
  app.use("/api/admin", adminRouter);

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
