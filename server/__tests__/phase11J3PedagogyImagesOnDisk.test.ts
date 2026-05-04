// Phase 11 J3 — sanity disque sur les images pédagogiques migrées.
//
// Miroir de medicalImagesOnDisk.test.ts pour le bloc additif
// `pedagogicalContent.images[].data` introduit en J3. Sans ce garde-fou,
// le rapport PDF Phase 11 J4 chargerait silencieusement une image
// 404 / cassée, et le candidat ne saurait pas lire son brief
// pédagogique.
//
// Couvre :
//   1. Existence sur disque pour CHAQUE `data` non-null exposé par les
//      stations migrées (lookup direct sous client/public/pedagogical-images/).
//   2. Validation regex `^/pedagogical-images/[a-z0-9]+(?:-[a-z0-9]+)*\.jpg$`
//      sur tous les chemins exposés (cohérence avec
//      `pedagogicalImagePathSchema`, invariant I16).
//   3. Ratio orphelins acceptable : la spec A21 autorise les fichiers
//      disque non référencés (les sources pédagogiques en couvrent
//      seulement un sous-ensemble du corpus). On vérifie qu'il reste
//      moins de 50 % d'orphelins, sinon échec — sinon warning informatif.

import { describe, expect, it, beforeAll } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { initCatalog, listStations } from "../services/stationsService";
import { getPatientStation } from "../services/patientService";

const IMAGES_DIR = path.resolve(import.meta.dirname, "..", "..", "client", "public", "pedagogical-images");
const SLUG_REGEX = /^\/pedagogical-images\/[a-z0-9]+(?:-[a-z0-9]+)*\.jpg$/;

beforeAll(async () => {
  await initCatalog();
});

interface ImageRef {
  stationId: string;
  data: string;
}

async function collectAllImageRefs(): Promise<ImageRef[]> {
  const refs: ImageRef[] = [];
  const stations = listStations();
  for (const meta of stations) {
    const station = await getPatientStation(meta.id);
    const ped = (station as { pedagogicalContent?: { images?: Array<{ data?: unknown }> } })
      .pedagogicalContent;
    const images = ped?.images;
    if (!Array.isArray(images)) continue;
    for (const img of images) {
      if (typeof img.data === "string" && img.data.length > 0) {
        refs.push({ stationId: meta.id, data: img.data });
      }
    }
  }
  return refs;
}

describe("Phase 11 J3 — pedagogicalContent.images[].data : sanity disque", () => {
  it("chaque `data` migré pointe vers un fichier qui existe dans client/public/pedagogical-images/", async () => {
    const refs = await collectAllImageRefs();
    expect(refs.length).toBeGreaterThan(100);
    const onDisk = new Set(await fs.readdir(IMAGES_DIR));
    const missing: string[] = [];
    for (const ref of refs) {
      const basename = path.basename(ref.data);
      if (!onDisk.has(basename)) {
        missing.push(`${ref.stationId} → ${ref.data}`);
      }
    }
    expect(
      missing.length,
      `Phase 11 J3 — ${missing.length} fichier(s) image manquant(s). Échantillon : ${missing.slice(0, 3).join(" || ")}`,
    ).toBe(0);
  });

  it("validation regex : tous les `data` exposés matchent /pedagogical-images/<slug>.jpg", async () => {
    const refs = await collectAllImageRefs();
    const malformed: string[] = [];
    for (const ref of refs) {
      if (!SLUG_REGEX.test(ref.data)) {
        malformed.push(`${ref.stationId} → ${ref.data}`);
      }
    }
    expect(
      malformed.length,
      `Phase 11 J3 — ${malformed.length} chemin(s) hors regex. Échantillon : ${malformed.slice(0, 3).join(" || ")}`,
    ).toBe(0);
  });

  it("ratio orphelins disque < 50 % : moins de la moitié des fichiers sont non référencés", async () => {
    const refs = await collectAllImageRefs();
    const referenced = new Set(refs.map((r) => path.basename(r.data)));
    const onDisk = (await fs.readdir(IMAGES_DIR)).filter((f) => f.toLowerCase().endsWith(".jpg"));
    const orphans = onDisk.filter((f) => !referenced.has(f));
    const ratio = orphans.length / onDisk.length;
    // eslint-disable-next-line no-console
    console.info(
      `[phase11J3-orphans] ${orphans.length}/${onDisk.length} fichiers disque non référencés (ratio ${(ratio * 100).toFixed(1)} %)`,
    );
    expect(
      ratio,
      `Plus de 50 % d'orphelins (${orphans.length}/${onDisk.length}) — vérifier l'intégrité de la migration.`,
    ).toBeLessThan(0.5);
  });
});
