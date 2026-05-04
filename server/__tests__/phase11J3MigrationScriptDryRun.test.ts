// Phase 11 J3 — tests dry-run du script de migration sur fixtures jouet.
//
// On crée un environnement éphémère dans tmp/phase11-test-fixtures/
// avec :
//   • un mini-catalog Patient_*.json contenant 3 stations de test
//   • un dossier de sources pédagogiques (mappable + non mappable)
//   • un dossier d'images simulant client/public/pedagogical-images/
//
// Tous les tests réutilisent ce contexte via `beforeAll` et nettoient
// dans `afterAll`. Aucune fixture réelle n'est touchée.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import {
  defaultOptions,
  runMigration,
  deriveStationCandidate,
  buildPedagogicalContent,
  SlugCollisionError,
  type MigrationOptions,
} from "../../scripts/migrate-pedagogical-content";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const FIXTURE_ROOT = path.join(ROOT, "tmp", "phase11-test-fixtures");
const FIXT_SOURCE = path.join(FIXTURE_ROOT, "sources");
const FIXT_PATIENT = path.join(FIXTURE_ROOT, "patient");
const FIXT_IMAGES = path.join(FIXTURE_ROOT, "images");
const FIXT_REPORT = path.join(FIXTURE_ROOT, "migration-report.json");

const TEST_OPTS: MigrationOptions = defaultOptions({
  sourceDir: FIXT_SOURCE,
  patientDir: FIXT_PATIENT,
  imagesDir: FIXT_IMAGES,
  reportPath: FIXT_REPORT,
});

// Catalog jouet : 3 stations dans 1 fichier Patient_*.json.
const TOY_CATALOG_FILE = "Patient_TEST.json";
const TOY_CATALOG = {
  source: "RESCOS",
  stations: [
    { id: "TEST-1 - Station test 1", nom: "Alice" },
    { id: "TEST-2 - Station test 2", nom: "Bob" },
    { id: "TEST-3 - Station sans source", nom: "Charlie" },
  ],
};

// Sources jouet : 1 mappable avec image, 1 mappable avec image manquante,
// 1 non mappable. Conformes au schéma source observé (annexes.{...}).
function srcWithImage(stationId: string, imgBasename: string) {
  return {
    title: `${stationId} - dummy`,
    annexes: {
      resume: { titre: "Résumé", sections: [{ titre: "Anamnèse", points: ["x"] }] },
      images: [
        {
          title: "Image test",
          description: "Description test",
          data: `grilles_generees/html/images/${imgBasename}`,
          id: "img1",
        },
      ],
    },
  };
}
function srcMinimal(stationId: string) {
  return {
    title: `${stationId} - dummy`,
    annexes: {
      presentationPatient: { titre: "Présentation minimale" },
    },
  };
}

beforeAll(async () => {
  await fs.rm(FIXTURE_ROOT, { recursive: true, force: true });
  await fs.mkdir(FIXT_SOURCE, { recursive: true });
  await fs.mkdir(FIXT_PATIENT, { recursive: true });
  await fs.mkdir(FIXT_IMAGES, { recursive: true });
});

afterAll(async () => {
  await fs.rm(FIXTURE_ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  // Reset catalog jouet à chaque test (l'apply mute le fichier).
  await fs.writeFile(
    path.join(FIXT_PATIENT, TOY_CATALOG_FILE),
    JSON.stringify(TOY_CATALOG, null, 2) + "\n",
    "utf-8",
  );
  // Vide les sources et images.
  for (const dir of [FIXT_SOURCE, FIXT_IMAGES]) {
    const files = await fs.readdir(dir).catch(() => []);
    for (const f of files) await fs.rm(path.join(dir, f), { force: true });
  }
});

describe("Phase 11 J3 — deriveStationCandidate (helper)", () => {
  it("extrait le préfixe avant ' - ' en préservant les espaces littéraux", () => {
    // Espaces préservés : 40 stations USMLE Triage N du catalogue ont
    // des espaces dans leur shortId (pas de space→dash !).
    expect(deriveStationCandidate("RESCOS-3 - Amaurose - 47 ans.json")).toBe("RESCOS-3");
    expect(deriveStationCandidate("USMLE Triage 39 - Surdose.json")).toBe("USMLE Triage 39");
    expect(deriveStationCandidate("AMBOSS-1 - Douleurs abdominales.json")).toBe("AMBOSS-1");
  });
});

describe("Phase 11 J3 — runMigration : dry-run sur fixtures jouet", () => {
  it("mapping nominal : 1 source TEST-1 → station TEST-1 détectée", async () => {
    await fs.writeFile(
      path.join(FIXT_SOURCE, "TEST-1 - Foo.json"),
      JSON.stringify(srcMinimal("TEST-1")),
      "utf-8",
    );
    const report = await runMigration(TEST_OPTS);
    expect(report.mapped).toHaveLength(1);
    expect(report.mapped[0].stationId).toBe("TEST-1");
    expect(report.mapped[0].sourceFile).toBe("TEST-1 - Foo.json");
    expect(report.unmapped).toHaveLength(0);
  });

  it("source non mappable (préfixe inconnu) → listée dans unmapped[]", async () => {
    await fs.writeFile(
      path.join(FIXT_SOURCE, "INCONNU-99 - Bar.json"),
      JSON.stringify(srcMinimal("INCONNU-99")),
      "utf-8",
    );
    const report = await runMigration(TEST_OPTS);
    expect(report.mapped).toHaveLength(0);
    expect(report.unmapped).toHaveLength(1);
    expect(report.unmapped[0].sourceFile).toBe("INCONNU-99 - Bar.json");
    expect(report.unmapped[0].reason).toMatch(/INCONNU-99/);
  });

  it("image référencée mais absente sur disque → omise + signalée dans imagesMissingOnDisk[]", async () => {
    // Image référencée par la source MAIS absente du dossier images jouet.
    await fs.writeFile(
      path.join(FIXT_SOURCE, "TEST-1 - Foo.json"),
      JSON.stringify(srcWithImage("TEST-1", "Image Manquante.jpg")),
      "utf-8",
    );
    const report = await runMigration(TEST_OPTS);
    expect(report.mapped[0].imagesMigrated).toBe(0);
    expect(report.mapped[0].imagesOmitted).toBe(1);
    expect(report.imagesMissingOnDisk).toContain("Image Manquante.jpg");
  });

  it("pedagogicalContent produit valide Zod (parse OK + récursif)", async () => {
    // Image présente sur disque pour permettre la migration complète.
    await fs.writeFile(path.join(FIXT_IMAGES, "Echo abdomen.jpg"), "x", "utf-8");
    await fs.writeFile(
      path.join(FIXT_SOURCE, "TEST-2 - Bar.json"),
      JSON.stringify(srcWithImage("TEST-2", "Echo abdomen.jpg")),
      "utf-8",
    );
    // Pas d'apply : juste vérifier que la build interne valide.
    const report = await runMigration(TEST_OPTS);
    expect(report.mapped[0].imagesMigrated).toBe(1);
    expect(report.imagesRenamed).toHaveLength(1);
    expect(report.imagesRenamed[0].from).toBe("Echo abdomen.jpg");
    expect(report.imagesRenamed[0].to).toBe("echo-abdomen.jpg");
    expect(report.validationErrors).toHaveLength(0);
  });

  it("dry-run : aucune écriture sur Patient_*.json jouet ni rename d'image", async () => {
    await fs.writeFile(path.join(FIXT_IMAGES, "Echo abdomen.jpg"), "x", "utf-8");
    await fs.writeFile(
      path.join(FIXT_SOURCE, "TEST-1 - Foo.json"),
      JSON.stringify(srcWithImage("TEST-1", "Echo abdomen.jpg")),
      "utf-8",
    );
    const before = await fs.readFile(path.join(FIXT_PATIENT, TOY_CATALOG_FILE), "utf-8");
    const beforeImages = await fs.readdir(FIXT_IMAGES);
    await runMigration(TEST_OPTS); // sans apply
    const after = await fs.readFile(path.join(FIXT_PATIENT, TOY_CATALOG_FILE), "utf-8");
    const afterImages = await fs.readdir(FIXT_IMAGES);
    expect(after).toBe(before);
    expect(afterImages).toEqual(beforeImages);
  });

  it("--apply : injection effective + idempotence (deuxième run = diff vide)", async () => {
    await fs.writeFile(path.join(FIXT_IMAGES, "Echo abdomen.jpg"), "x", "utf-8");
    await fs.writeFile(
      path.join(FIXT_SOURCE, "TEST-1 - Foo.json"),
      JSON.stringify(srcWithImage("TEST-1", "Echo abdomen.jpg")),
      "utf-8",
    );
    const opts = { ...TEST_OPTS, apply: true };

    const report1 = await runMigration(opts);
    expect(report1.mode).toBe("applied");
    const after1 = await fs.readFile(path.join(FIXT_PATIENT, TOY_CATALOG_FILE), "utf-8");
    const parsed1 = JSON.parse(after1) as { stations: Array<Record<string, unknown>> };
    expect(parsed1.stations[0].pedagogicalContent).toBeDefined();
    // pedagogicalContent doit être en DERNIÈRE position (clé d'insertion).
    const keys = Object.keys(parsed1.stations[0]);
    expect(keys[keys.length - 1]).toBe("pedagogicalContent");
    // L'image a été renommée.
    const imagesAfter1 = await fs.readdir(FIXT_IMAGES);
    expect(imagesAfter1).toContain("echo-abdomen.jpg");
    expect(imagesAfter1).not.toContain("Echo abdomen.jpg");

    // Deuxième run : doit être idempotent (aucun diff).
    await runMigration(opts);
    const after2 = await fs.readFile(path.join(FIXT_PATIENT, TOY_CATALOG_FILE), "utf-8");
    expect(after2).toBe(after1);
    const imagesAfter2 = await fs.readdir(FIXT_IMAGES);
    expect(imagesAfter2.sort()).toEqual(imagesAfter1.sort());
  });
});

describe("Phase 11 J3 — collisions de slug", () => {
  it("deux basenames distincts → même slug → SlugCollisionError fail-fast", async () => {
    // « Image-test.jpg » et « image test.jpg » slugifient tous les deux
    // vers « image-test.jpg » → collision.
    await fs.writeFile(path.join(FIXT_IMAGES, "Image-test.jpg"), "a", "utf-8");
    await fs.writeFile(path.join(FIXT_IMAGES, "image test.jpg"), "b", "utf-8");
    await fs.writeFile(
      path.join(FIXT_SOURCE, "TEST-1 - Foo.json"),
      JSON.stringify(srcWithImage("TEST-1", "Image-test.jpg")),
      "utf-8",
    );
    await fs.writeFile(
      path.join(FIXT_SOURCE, "TEST-2 - Bar.json"),
      JSON.stringify(srcWithImage("TEST-2", "image test.jpg")),
      "utf-8",
    );
    await expect(runMigration(TEST_OPTS)).rejects.toBeInstanceOf(SlugCollisionError);
  });
});
