import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  // Phase 12 Axe B J2 — bundle serveur en ESM (cf. script/build.ts).
  // `__dirname` n'existe pas en ESM ; `import.meta.dirname` est natif
  // depuis Node 20.11. Cohérent avec stationsService et prompts.
  const distPath = path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
