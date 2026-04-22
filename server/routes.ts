import type { Express } from "express";
import { type Server } from "http";

import { loadConfig } from "./lib/config";
import { initCatalog } from "./services/stationsService";
import adminRouter from "./routes/admin";
import settingsRouter from "./routes/settings";
import patientRouter from "./routes/patient";
import evaluatorRouter from "./routes/evaluator";
import stationsRouter from "./routes/stations";

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // Charge les clés API en mémoire (process.env + .env.local).
  await loadConfig();

  // Parse l'ensemble des JSON de stations et construit le catalogue en mémoire.
  await initCatalog();

  app.use("/api/stations", stationsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/patient", patientRouter);
  app.use("/api/evaluator", evaluatorRouter);
  app.use("/api/admin", adminRouter);

  return httpServer;
}
