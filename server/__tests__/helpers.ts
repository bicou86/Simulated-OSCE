// Helper pour monter les routers dans une app Express nue (sans Vite, sans httpServer).
// Utilisé par tous les tests supertest. Source de vérité unique partagée avec
// `registerRoutes` via `mountApiRoutes` — un routeur ajouté côté runtime est
// automatiquement couvert par les tests (et vice-versa).

import express from "express";
import { mountApiRoutes } from "../routes";

export function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  mountApiRoutes(app);
  return app;
}
