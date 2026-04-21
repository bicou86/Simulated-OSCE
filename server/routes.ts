import type { Express } from "express";
import { type Server } from "http";

import { loadConfig } from "./lib/config";
import settingsRouter from "./routes/settings";
import patientRouter from "./routes/patient";
import evaluatorRouter from "./routes/evaluator";

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // Charge les clés API en mémoire (process.env + .env.local).
  await loadConfig();

  app.use("/api/settings", settingsRouter);
  app.use("/api/patient", patientRouter);
  app.use("/api/evaluator", evaluatorRouter);

  return httpServer;
}
