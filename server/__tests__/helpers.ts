// Helper pour monter les routers dans une app Express nue (sans Vite, sans httpServer).
// Utilisé par tous les tests supertest.

import express from "express";
import settingsRouter from "../routes/settings";
import patientRouter from "../routes/patient";
import evaluatorRouter from "../routes/evaluator";

export function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use("/api/settings", settingsRouter);
  app.use("/api/patient", patientRouter);
  app.use("/api/evaluator", evaluatorRouter);
  return app;
}
