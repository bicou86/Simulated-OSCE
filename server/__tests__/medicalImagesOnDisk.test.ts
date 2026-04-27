// Test de sanity Phase 3 — chaque `resultat_url` dans les JSON patients doit
// pointer vers un fichier physiquement présent sous
// `client/public/medical-images/` (la publicDir de Vite). Sans ce garde-fou,
// un URL pointant vers un fichier manquant renverrait silencieusement une
// image cassée au candidat en simulation.
//
// Le test parcourt tous les Patient_*.json, extrait les URLs image, et
// vérifie leur existence sur disque. Lève une erreur explicite avec le
// chemin attendu si un fichier manque.

import { describe, it, expect } from "vitest";
import { promises as fs } from "fs";
import path from "path";

const PATIENT_DIR = path.resolve(__dirname, "..", "data", "patient");
const PUBLIC_DIR = path.resolve(__dirname, "..", "..", "client", "public");

interface FoundImage {
  file: string;         // fichier JSON source
  stationId: string;    // id complet de la station
  categoryKey: string;  // e1, e2, ...
  url: string;          // valeur de resultat_url
}

async function collectImageUrls(): Promise<FoundImage[]> {
  const entries = await fs.readdir(PATIENT_DIR);
  const found: FoundImage[] = [];
  for (const name of entries) {
    if (!name.startsWith("Patient_") || !name.endsWith(".json")) continue;
    const raw = await fs.readFile(path.join(PATIENT_DIR, name), "utf-8");
    const data = JSON.parse(raw) as { stations?: unknown[] };
    const stations = Array.isArray(data.stations) ? data.stations : [];
    for (const st of stations) {
      if (!st || typeof st !== "object") continue;
      const s = st as { id?: string; examen_resultats?: Record<string, unknown> };
      if (!s.examen_resultats) continue;
      for (const [key, rawCat] of Object.entries(s.examen_resultats)) {
        if (!rawCat || typeof rawCat !== "object") continue;
        const cat = rawCat as {
          resultat_url?: unknown;
          details?: unknown[];
        };
        // URL au niveau catégorie.
        if (typeof cat.resultat_url === "string" && cat.resultat_url.length > 0) {
          found.push({ file: name, stationId: s.id ?? "", categoryKey: key, url: cat.resultat_url });
        }
        // URL au niveau détail.
        const details = Array.isArray(cat.details) ? cat.details : [];
        for (const d of details) {
          if (!d || typeof d !== "object") continue;
          const det = d as { resultat_url?: unknown };
          if (typeof det.resultat_url === "string" && det.resultat_url.length > 0) {
            found.push({
              file: name, stationId: s.id ?? "", categoryKey: key, url: det.resultat_url,
            });
          }
        }
      }
    }
  }
  return found;
}

describe("Phase 3 — toutes les images référencées existent sur disque", () => {
  it("chaque resultat_url pointe vers un fichier sous client/public/", async () => {
    const images = await collectImageUrls();
    expect(images.length).toBeGreaterThan(0); // au moins les 5 pilotes J1

    const missing: string[] = [];
    for (const img of images) {
      // Le URL est servi par Vite depuis publicDir (client/public/).
      // On reconstruit le chemin disque correspondant.
      const relative = img.url.startsWith("/") ? img.url.slice(1) : img.url;
      const diskPath = path.join(PUBLIC_DIR, relative);
      try {
        await fs.access(diskPath);
      } catch {
        missing.push(
          `${img.stationId} [${img.categoryKey}] → ${img.url} (attendu: ${diskPath})`,
        );
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `${missing.length} fichier(s) image manquant(s) :\n  - ${missing.join("\n  - ")}`,
      );
    }
  });

  it("chaque dossier station avec images contient ATTRIBUTIONS.md", async () => {
    const images = await collectImageUrls();
    const stationDirs = new Set(
      images.map((img) => {
        const rel = img.url.startsWith("/") ? img.url.slice(1) : img.url;
        // /medical-images/<station-id>/<file> → dossier station-id
        const parts = rel.split("/");
        return parts.slice(0, parts.length - 1).join("/");
      }),
    );

    const missing: string[] = [];
    for (const dir of stationDirs) {
      const attrPath = path.join(PUBLIC_DIR, dir, "ATTRIBUTIONS.md");
      try {
        await fs.access(attrPath);
      } catch {
        missing.push(`${dir}/ATTRIBUTIONS.md`);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `${missing.length} ATTRIBUTIONS.md manquant(s) :\n  - ${missing.join("\n  - ")}`,
      );
    }
  });
});
