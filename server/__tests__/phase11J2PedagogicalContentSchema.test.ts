// Phase 11 J2 + J2bis — tests Zod du schéma `pedagogicalContent`.
//
// Couvre :
//   • Schéma vide accepté (additif strict, tout optionnel à tous niveaux)
//   • Schéma complet valide (anciens noms J2 `presentation` / `theory`)
//   • Regex stricte sur `images[].data` : refuse une chaîne ne matchant
//     pas `^/pedagogical-images/<slug>.jpg$`
//   • Refus explicite des chemins `/medical-images/...` (mauvais préfixe,
//     symétrie avec invariant I16)
//   • Le `stationSchema` étendu parse les 285 stations actuelles sans
//     régression
//   • Phase 11 J2bis (5 tests additionnels) :
//       1. Récursivité 3 niveaux `sections[].subsections[].subsections[]`
//       2. theoriePratique avec champ libre `examensComplementaires`
//       3. theoriePratique avec champ libre `phrasesCles` (autre variante)
//       4. presentationPatient avec uniquement `titre`
//       5. Parse OK des 285 fichiers réels de tmp/phase11-pedagogy-source/
//          après extraction de leurs blocs annexes pédagogiques

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

describe("Phase 11 J2bis — récursivité .passthrough() sur arborescence pédagogique", () => {
  it("parse OK d'un resume avec sections[].subsections[].subsections[] (3 niveaux)", () => {
    const tree = {
      resume: {
        titre: "Résumé clinique",
        sections: [
          {
            titre: "Anamnèse",
            subsections: [
              {
                titre: "Symptômes typiques",
                subsections: [
                  { titre: "Douleur", points: ["intense", "constante"] },
                ],
              },
            ],
          },
        ],
      },
    };
    const parsed = pedagogicalContentSchema.parse(tree);
    expect(parsed.resume?.sections?.[0]?.subsections?.[0]?.subsections?.[0]?.titre).toBe(
      "Douleur",
    );
    expect(parsed.resume?.sections?.[0]?.subsections?.[0]?.subsections?.[0]?.points).toEqual([
      "intense",
      "constante",
    ]);
  });

  it("parse OK d'un theoriePratique avec champ libre `examensComplementaires` (passthrough)", () => {
    const tree = {
      theoriePratique: {
        titre: "Théorie pratique concernant la vignette",
        sections: [{ titre: "Diagnostic", contenu: "Cholécystite aiguë probable" }],
        examensComplementaires: {
          titre: "Examens complémentaires",
          items: ["Échographie abdominale", "Bilan hépatique"],
        },
        rappelsTherapeutiques: { titre: "Rappels", points: ["Hospitalisation"] },
      },
    };
    const parsed = pedagogicalContentSchema.parse(tree) as {
      theoriePratique?: { examensComplementaires?: { items?: string[] } };
    };
    expect(parsed.theoriePratique?.examensComplementaires?.items).toEqual([
      "Échographie abdominale",
      "Bilan hépatique",
    ]);
  });

  it("parse OK d'un theoriePratique avec champ libre `phrasesCles` (autre variante)", () => {
    const tree = {
      theoriePratique: {
        titre: "Communication empathique",
        sections: [{ titre: "Cadre", contenu: "Annonce d'une mauvaise nouvelle" }],
        phrasesCles: ["Je comprends que c'est difficile", "Prenons le temps"],
        techniquesEmpathie: { titre: "Techniques", points: ["NURSE", "SPIKES"] },
      },
    };
    const parsed = pedagogicalContentSchema.parse(tree) as {
      theoriePratique?: { phrasesCles?: string[]; techniquesEmpathie?: { points?: string[] } };
    };
    expect(parsed.theoriePratique?.phrasesCles).toHaveLength(2);
    expect(parsed.theoriePratique?.techniquesEmpathie?.points).toEqual(["NURSE", "SPIKES"]);
  });

  it("parse OK d'un presentationPatient avec uniquement `titre` (tout le reste optionnel)", () => {
    const tree = { presentationPatient: { titre: "📑 Fiche ECOS – Cas pédagogique" } };
    const parsed = pedagogicalContentSchema.parse(tree);
    expect(parsed.presentationPatient?.titre).toBe("📑 Fiche ECOS – Cas pédagogique");
    expect(parsed.presentationPatient?.sections).toBeUndefined();
  });

  it("parse OK des 285 fichiers réels de tmp/phase11-pedagogy-source/ (annexes extraits)", async () => {
    // Test d'intégration de validation : on lit les 285 sources brutes,
    // on extrait `annexes.{resume, presentationPatient, theoriePratique, images}`,
    // et on vérifie que l'objet composé parse contre le schéma J2bis.
    // Pas de migration : ce test ne touche AUCUN Patient_*.json.
    //
    // Les images sources portent un `data` au format
    // `grilles_generees/html/images/...` (incompatible avec la regex
    // `pedagogicalImagePathSchema`) ; on les exclut de l'objet validé
    // (la regex `data` reste vérifiée séparément en J3 via les tests de
    // baseline disque).
    const SOURCE_DIR = path.resolve(import.meta.dirname, "..", "..", "tmp", "phase11-pedagogy-source");
    let files: string[];
    try {
      files = await fs.readdir(SOURCE_DIR);
    } catch (e) {
      // Si le dossier n'existe pas (CI propre, push utilisateur partiel),
      // on saute ce test plutôt que de le faire échouer en faux positif.
      // eslint-disable-next-line no-console
      console.warn(`[phase11J2bis] tmp/phase11-pedagogy-source/ absent — test sources sauté`);
      return;
    }
    const sourceFiles = files.filter((f) => f.endsWith(".json"));
    expect(sourceFiles.length).toBeGreaterThanOrEqual(280);

    let parsedOk = 0;
    const failures: string[] = [];
    for (const f of sourceFiles) {
      const raw = JSON.parse(
        await fs.readFile(path.join(SOURCE_DIR, f), "utf-8"),
      ) as { annexes?: Record<string, unknown> };
      const annexes = raw.annexes ?? {};
      // On omet `images` du test (les `data` sources ne respectent pas la
      // regex /pedagogical-images/...). C'est le rôle du script de
      // migration J3 de slugifier puis remplacer `data`.
      const candidate: Record<string, unknown> = {};
      if (annexes.resume !== undefined) candidate.resume = annexes.resume;
      if (annexes.presentationPatient !== undefined) candidate.presentationPatient = annexes.presentationPatient;
      if (annexes.theoriePratique !== undefined) candidate.theoriePratique = annexes.theoriePratique;
      const result = pedagogicalContentSchema.safeParse(candidate);
      if (result.success) {
        parsedOk++;
      } else {
        failures.push(`${f}: ${result.error.issues[0]?.message ?? "?"}`);
      }
    }
    expect(
      failures.length,
      `Phase 11 J2bis — ${failures.length}/${sourceFiles.length} sources échouent au parse. Échantillon : ${failures.slice(0, 3).join(" || ")}`,
    ).toBe(0);
    expect(parsedOk).toBe(sourceFiles.length);
  });
});
