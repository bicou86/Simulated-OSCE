// Phase 11 J2 — tests Zod du schéma `pedagogicalContent`.
//
// Couvre :
//   • Schéma vide accepté (additif strict, tout optionnel à tous niveaux)
//   • Schéma complet valide
//   • Regex stricte sur `images[].data` : refuse une chaîne ne matchant
//     pas `^/pedagogical-images/<slug>.jpg$`
//   • Refus explicite des chemins `/medical-images/...` (mauvais préfixe,
//     symétrie avec invariant I16)
//   • Le `stationSchema` étendu parse les 285 stations actuelles sans
//     régression (corpus catalog réel — non-régression Phase 2 sha256
//     préservée tant qu'aucun fichier station n'est touché en J2 ; cible
//     canonique 278 stations sha256-verrouillées + 9 exclues d'audit).

import { describe, expect, it, beforeAll } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { pedagogicalContentSchema } from "@shared/pedagogical-content-schema";
import { stationSchema } from "@shared/station-schema";
import { initCatalog, listStations } from "../services/stationsService";

beforeAll(async () => {
  await initCatalog();
});

describe("Phase 11 J2 — pedagogicalContentSchema (additif strict)", () => {
  it("parse({}) réussit (tous champs optionnels à la racine)", () => {
    const parsed = pedagogicalContentSchema.parse({});
    expect(parsed).toEqual({});
  });

  it("schéma complet valide parse OK avec les 4 sous-blocs", () => {
    const full = {
      resume: { title: "Résumé clinique", body: "Cas typique de…" },
      presentation: { title: "Présentation type", body: "Anamnèse + examen + paracliniques attendus." },
      theory: { title: "Théorie", body: "Physiopathologie, scores, drapeaux rouges." },
      images: [
        {
          data: "/pedagogical-images/echographie-abdominale.jpg",
          caption: "Échographie abdominale en coupe transverse",
          alt: "Échographie",
        },
        {
          data: "/pedagogical-images/radiographie-thorax-pa.jpg",
          caption: "Radiographie de thorax PA",
        },
      ],
    };
    const parsed = pedagogicalContentSchema.parse(full);
    expect(parsed.images).toHaveLength(2);
    expect(parsed.images?.[0]?.data).toBe("/pedagogical-images/echographie-abdominale.jpg");
    expect(parsed.resume?.title).toBe("Résumé clinique");
  });

  it("images[].data non conforme à la regex → erreur Zod explicite", () => {
    const bad = {
      images: [{ data: "echographie.jpg" }], // pas de préfixe absolu /pedagogical-images/
    };
    const result = pedagogicalContentSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" | ");
      expect(msg).toMatch(/Chemin image pédagogique invalide/);
    }
  });

  it("images[].data = /medical-images/foo.jpg → rejeté (mauvais préfixe, invariant I16)", () => {
    const bad = {
      images: [{ data: "/medical-images/foo.jpg" }],
    };
    const result = pedagogicalContentSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("toutes les stations actuelles parsent OK avec stationSchema étendu (non-régression)", async () => {
    // On ré-itère sur le corpus catalog en lisant directement les fichiers
    // physiques (le catalog ne stocke que des meta — il faut le payload
    // brut pour exercer le schéma Zod complet incluant le nouveau champ
    // optionnel `pedagogicalContent`). Aucun fichier station n'est touché
    // en J2 ⇒ les 278 sha256-verrouillées (Phase 2 checksum) sont
    // strictement préservées ; toute station legacy parse comme avant.
    //
    // Cible runtime : 288 stations (catalog post-dédup Phase 8 J2 — Phase 7 = 287
    // stations + 1 RESCOS-64-P2). À comparer aux 278 sha256-verrouillées
    // (avec 9 exclusions : AMBOSS-4, RESCOS-70, RESCOS-71, RESCOS-9b,
    // RESCOS-13, RESCOS-63, AMBOSS-24, USMLE-34, RESCOS-72) auxquelles
    // s'ajoutent les stations exclues du verrouillage sha256 (legal,
    // double, audit) qui parsent quand même.
    const stations = listStations();
    expect(stations.length).toBeGreaterThanOrEqual(285);

    const PATIENT_DIR = path.resolve(import.meta.dirname, "..", "data", "patient");
    const files = await fs.readdir(PATIENT_DIR);
    const patientFiles = files.filter((f) => f.startsWith("Patient_") && f.endsWith(".json"));

    let parsedCount = 0;
    for (const file of patientFiles) {
      const content = await fs.readFile(path.join(PATIENT_DIR, file), "utf-8");
      const json = JSON.parse(content) as { stations: Array<Record<string, unknown>> };
      for (const raw of json.stations) {
        const result = stationSchema.safeParse(raw);
        expect(
          result.success,
          `station ${(raw.id as string) ?? "<no id>"} ne parse plus avec stationSchema étendu Phase 11 J2 : ${
            result.success ? "" : result.error.message
          }`,
        ).toBe(true);
        parsedCount++;
      }
    }
    // parsedCount inclut les payloads bruts de TOUS les fichiers Patient_*
    // (sans dédup par shortId). Tant qu'on parse au moins autant que le
    // catalog dédupliqué, le schéma reste compatible avec l'ensemble du
    // corpus.
    expect(parsedCount).toBeGreaterThanOrEqual(stations.length);
  });
});
