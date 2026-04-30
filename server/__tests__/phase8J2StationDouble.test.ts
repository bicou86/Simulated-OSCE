// Phase 8 J2 — tests d'intégration de la station double RESCOS-64.
//
// J1 a posé le schéma `parentStationId` (additif optionnel) + la
// validation référentielle two-pass `validateParentStationIds` côté
// `stationsService`. J2 active concrètement le mécanisme :
//
//   1. `extractShortId` reconnaît le pattern « Station double 2 » et
//      suffixe `-P2` ⇒ partie 2 indexable distinctement dans le catalog
//      (« RESCOS-64-P2 »), partie 1 garde son shortId historique
//      (« RESCOS-64 ») pour préserver les baselines HTTP existantes
//      (arbitrage Q2 R3 asymétrique).
//   2. La fixture partie 2 est complétée dans `Patient_RESCOS_4.json`
//      (additif : `parentStationId: "RESCOS-64"` + `medicoLegalReviewed: true`,
//      le reste du bloc partie 2 est inchangé).
//   3. `parentStationId` est ajouté à `META_FIELDS_TO_STRIP` côté
//      `patientService` ⇒ jamais exposé au LLM ou au brief HTTP.
//   4. Catalog passe de 287 à 288 stations physiques ; partie 1 et
//      partie 2 sont distinctes.
//
// Couvre :
//   • extractShortId : pattern « Station double 2 » → -P2,
//     « Station double 1 » et autres titres : comportement historique
//     préservé.
//   • validateParentStationIds : référence « RESCOS-64 » résout depuis
//     RESCOS-64-P2 (boot OK).
//   • catalog.size === 288 (Phase 7 = 287, +1 RESCOS-64-P2).
//   • Brief HTTP partie 1 (« RESCOS-64 ») : 647 bytes UTF-8 inchangé,
//     non-régression Phase 7.
//   • Brief HTTP partie 2 (« RESCOS-64-P2 ») : status 200, 362 bytes
//     UTF-8 (nouvelle baseline Phase 8 J2 actée).
//   • Stripping `parentStationId` : jamais dans le brief HTTP partie 2.
//   • Briefs HTTP des 5 stations legal Phase 7 : baselines UTF-8 stables
//     528/540/717/513/509 (non-régression).
//
// Contraintes : ZÉRO appel LLM, ZÉRO mock fs. On consomme les vraies
// fixtures du repo (Phase 8 J2 appliqué).

import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import {
  initCatalog,
  listStations,
  __test__ as stationsTest,
} from "../services/stationsService";
import { getPatientBrief } from "../services/patientService";
import { buildTestApp } from "./helpers";

beforeAll(async () => {
  await initCatalog();
});

describe("Phase 8 J2 — extractShortId : pattern Station double 2 → -P2", () => {
  const extract = stationsTest.extractShortId;

  it("RESCOS-64 partie 2 → shortId « RESCOS-64-P2 »", () => {
    expect(extract("RESCOS-64 - Toux - Station double 2")).toBe("RESCOS-64-P2");
  });

  it("RESCOS-64 partie 1 → shortId « RESCOS-64 » (historique préservé, asymétrique R3)", () => {
    expect(extract("RESCOS-64 - Toux - Station double 1")).toBe("RESCOS-64");
  });

  it("autres titres : comportement historique inchangé", () => {
    // Échantillon : 3 titres représentatifs (legal Phase 7 + standard).
    expect(extract("AMBOSS-24 - Évaluation après chute - Femme 30 ans")).toBe("AMBOSS-24");
    expect(extract("RESCOS-1 - Adénopathie sus-claviculaire - ECC Lymphatique")).toBe("RESCOS-1");
    expect(extract("USMLE Triage 39")).toBe("USMLE Triage 39");
  });

  it("aucun faux positif sur titres non-double (ex. fin variée)", () => {
    // Pattern strict /Station double 2$/. « Double 2 » ailleurs ne déclenche pas.
    expect(extract("AMBOSS-2 - Douleur")).toBe("AMBOSS-2");
    expect(extract("FAKE - Station double 22")).toBe("FAKE");
    expect(extract("FAKE - Station double 2 - suite")).toBe("FAKE");
  });
});

describe("Phase 8 J2 — catalog & validation référentielle", () => {
  it("catalog contient 288 stations (Phase 7 = 287, +1 RESCOS-64-P2)", () => {
    const stations = listStations();
    expect(stations.length).toBe(288);
  });

  it("RESCOS-64 (partie 1) et RESCOS-64-P2 (partie 2) sont distinctes dans le catalog", () => {
    const stations = listStations();
    const p1 = stations.find((s) => s.id === "RESCOS-64");
    const p2 = stations.find((s) => s.id === "RESCOS-64-P2");
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    // Partie 1 : pas de parentStationId (station racine).
    expect(p1!.parentStationId).toBeUndefined();
    // Partie 2 : parentStationId pointe vers la partie 1 (shortId).
    expect(p2!.parentStationId).toBe("RESCOS-64");
    // Partie 2 partage le fichier physique avec partie 1.
    expect(p2!.patientFile).toBe("Patient_RESCOS_4.json");
  });

  it("exactement 1 paire double détectée (1/288 stations avec parentStationId)", () => {
    const stations = listStations();
    const withParent = stations.filter((s) => s.parentStationId !== undefined);
    expect(withParent.length).toBe(1);
    expect(withParent[0].id).toBe("RESCOS-64-P2");
  });

  it("validateParentStationIds : référence depuis RESCOS-64-P2 résout (boot pass)", () => {
    // initCatalog a déjà été appelé dans beforeAll. Si la validation
    // référentielle avait échoué, le beforeAll aurait throw et tous
    // les tests de ce describe seraient en erreur. On consolide en
    // re-exécutant la validation pure sur le catalog actuel.
    const known = new Set(listStations().map((s) => s.id));
    const errors = stationsTest.checkParentStationIdReferences(
      listStations().map((s) => ({ fullId: s.fullId, parentStationId: s.parentStationId })),
      known,
    );
    expect(errors).toEqual([]);
  });
});

describe("Phase 8 J2 — Brief HTTP partie 1 RESCOS-64 (non-régression)", () => {
  it("getPatientBrief(« RESCOS-64 ») = 647 bytes UTF-8 (baseline Chrome préservée)", async () => {
    const brief = await getPatientBrief("RESCOS-64");
    const json = JSON.stringify(brief);
    const bytes = Buffer.byteLength(json, "utf-8");
    expect(bytes).toBe(647);
  });

  it("brief partie 1 : setting « Cabinet de médecine générale » (consultation patient simulé)", async () => {
    const brief = await getPatientBrief("RESCOS-64");
    expect(brief.setting).toBe("Cabinet de médecine générale");
  });

  it("brief partie 1 : aucune fuite parentStationId (partie 1 n'en a pas, sécurité)", async () => {
    const brief = await getPatientBrief("RESCOS-64");
    const json = JSON.stringify(brief);
    expect(json).not.toContain("parentStationId");
  });

  it("GET /api/patient/RESCOS-64/brief : status 200 + 647 bytes UTF-8", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-64/brief");
    expect(res.status).toBe(200);
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(647);
  });
});

describe("Phase 8 J2 — Brief HTTP partie 2 RESCOS-64-P2 (nouvelle baseline)", () => {
  it("getPatientBrief(« RESCOS-64-P2 ») = 362 bytes UTF-8 (baseline Phase 8 J2 actée)", async () => {
    const brief = await getPatientBrief("RESCOS-64-P2");
    const json = JSON.stringify(brief);
    const bytes = Buffer.byteLength(json, "utf-8");
    expect(bytes).toBe(362);
  });

  it("brief partie 2 : setting « Présentation de Mme Dumont au pneumologue »", async () => {
    const brief = await getPatientBrief("RESCOS-64-P2");
    expect(brief.setting).toBe("Présentation de Mme Dumont au pneumologue");
  });

  it("brief partie 2 : stripping parentStationId (jamais dans le brief)", async () => {
    const brief = await getPatientBrief("RESCOS-64-P2");
    const json = JSON.stringify(brief);
    // Bien que parentStationId soit défini sur la fixture, il NE DOIT PAS
    // apparaître dans le brief HTTP (META_FIELDS_TO_STRIP étendu Phase 8 J2).
    expect(json).not.toContain("parentStationId");
  });

  it("brief partie 2 : stripping legalContext + medicoLegalReviewed (cohérence Phase 5/6)", async () => {
    const brief = await getPatientBrief("RESCOS-64-P2");
    const json = JSON.stringify(brief);
    expect(json).not.toContain("legalContext");
    expect(json).not.toContain("medicoLegalReviewed");
  });

  it("GET /api/patient/RESCOS-64-P2/brief : status 200 + 362 bytes UTF-8", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-64-P2/brief");
    expect(res.status).toBe(200);
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(362);
    // Le shortId est toujours stable côté client (pas de leak interne).
    expect(res.body.stationId).toBe("RESCOS-64-P2");
  });
});

describe("Phase 8 J2 — Briefs HTTP 5 stations legal Phase 7 (non-régression byte-à-byte)", () => {
  // Baselines figées Phase 7 J4 (cf. brief J2 Phase 8 §État corpus).
  // Aucune fixture legal modifiée en J2 ⇒ aucune dérive attendue.
  const BASELINES: Array<{ id: string; bytes: number }> = [
    { id: "AMBOSS-24", bytes: 528 },
    { id: "USMLE-34", bytes: 540 },
    { id: "RESCOS-72", bytes: 717 },
    { id: "USMLE Triage 39", bytes: 513 },
    { id: "USMLE-9", bytes: 509 },
  ];

  it.each(BASELINES)(
    "$id : brief HTTP $bytes bytes UTF-8 (baseline Phase 7 J4 stable)",
    async ({ id, bytes }) => {
      const brief = await getPatientBrief(id);
      const json = JSON.stringify(brief);
      const measured = Buffer.byteLength(json, "utf-8");
      expect(measured, `${id} : drift baseline (attendu ${bytes}, mesuré ${measured})`).toBe(bytes);
    },
  );
});
