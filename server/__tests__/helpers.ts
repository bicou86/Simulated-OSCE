// Helper pour monter les routers dans une app Express nue (sans Vite, sans httpServer).
// Utilisé par tous les tests supertest.

import express from "express";
import adminRouter from "../routes/admin";
import settingsRouter from "../routes/settings";
import patientRouter from "../routes/patient";
import evaluatorRouter from "../routes/evaluator";
import stationsRouter from "../routes/stations";

export function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use("/api/stations", stationsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/patient", patientRouter);
  app.use("/api/evaluator", evaluatorRouter);
  app.use("/api/admin", adminRouter);
  return app;
}
