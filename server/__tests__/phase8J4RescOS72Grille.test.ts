// Phase 8 J4 — Sujet 2 : intégration de la grille évaluateur RESCOS-72
// (certificat de complaisance, dette Phase 5 J1 fermée).
//
// Vérifie post-intégration de la grille (additif strict après RESCOS-71
// dans Examinateur_RESCOS_4.json) :
//
//   • Structure grille : 5 axes ECOS classiques (anamnese / examen /
//     management / cloture / communication), 20 items au total, format
//     conforme aux conventions Phase 8 J3 (binaryOnly + scoringRule
//     count-based / alias-binaire selon items).
//   • getEvaluatorStation("RESCOS-72") retourne la grille complète.
//   • parseScoringRule sur les rules de la grille = aucun warn (toutes
//     parsables), modes count + alias-binaire seulement (pas de token).
//   • Non-régression scoring legal : evaluateLegal sur RESCOS-72 retourne
//     toujours 4 axes Phase 5/7 (reconnaissance / verbalisation /
//     decision / communication) — la grille n'altère PAS le scoring
//     legal (cf. invariant Phase 8 J4 §5).
//   • Non-régression brief HTTP : 717 bytes UTF-8 byte-à-byte stable
//     (la grille évaluateur n'est pas exposée côté patient).
//   • Endpoint /api/debug/evaluation-weights : RESCOS-72 retourne 6 axes
//     pondérés Phase 7 J2 (medico_legal=10 + 5 axes × 22.5/2 — pondération
//     proportionnelle × 0.9 quand legalContext présent).
//
// CONTRAINTES : ZÉRO appel LLM, ZÉRO mock fs (vraies fixtures).

import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { initCatalog } from "../services/stationsService";
import { getEvaluatorStation } from "../services/evaluatorService";
import { getPatientBrief } from "../services/patientService";
import { evaluateLegal } from "../services/legalEvaluator";
import { __test__ as presTest } from "../services/presentationEvaluator";
import { buildTestApp } from "./helpers";

beforeAll(async () => {
  await initCatalog();
});

describe("Phase 8 J4 — RESCOS-72 grille évaluateur (dette Phase 5 J1 fermée)", () => {
  it("getEvaluatorStation retourne la grille avec 5 axes ECOS classiques", async () => {
    const station = await getEvaluatorStation("RESCOS-72");
    expect(station.id).toBe("RESCOS-72 - Certificat de complaisance - Arrêt de travail abusif");
    expect(station.grille).toBeDefined();
    expect(Object.keys(station.grille).sort()).toEqual([
      "anamnese",
      "cloture",
      "communication",
      "examen",
      "management",
    ]);
  });

  it("compteurs items par axe (20 total)", async () => {
    const station = await getEvaluatorStation("RESCOS-72");
    expect(station.grille.anamnese.length).toBe(5);
    expect(station.grille.examen.length).toBe(4);
    expect(station.grille.management.length).toBe(5);
    expect(station.grille.cloture.length).toBe(3);
    expect(station.grille.communication.length).toBe(3);
    const total = Object.values(station.grille as Record<string, unknown[]>)
      .reduce((sum, arr) => sum + arr.length, 0);
    expect(total).toBe(20);
  });

  it("patient_resume + diagnostic_attendu présents (cohérence avec convention Sonnet)", async () => {
    const station = await getEvaluatorStation("RESCOS-72");
    expect(typeof station.patient_resume).toBe("string");
    expect(station.patient_resume.length).toBeGreaterThan(50);
    expect(station.patient_resume).toMatch(/Marc Bernard/);
    expect(typeof station.diagnostic_attendu).toBe("string");
    expect(station.diagnostic_attendu).toMatch(/certificat.*complaisance/i);
    expect(station.diagnostic_attendu).toMatch(/318 CP/);
  });

  it("toutes les scoringRule présentes sont parsables sans warn", async () => {
    const station = await getEvaluatorStation("RESCOS-72");
    const calls: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => calls.push(msg);
    try {
      for (const axis of ["anamnese", "examen", "management", "cloture", "communication"] as const) {
        for (const item of station.grille[axis]) {
          if (item.scoringRule) {
            presTest.parseScoringRule(item.scoringRule, item.id);
          }
        }
      }
    } finally {
      console.warn = origWarn;
    }
    expect(calls).toEqual([]);
  });

  it("modes scoringRule observés : count-based et alias-binaire uniquement (pas de token)", async () => {
    const station = await getEvaluatorStation("RESCOS-72");
    const modes = new Set<string>();
    for (const axis of ["anamnese", "examen", "management", "cloture", "communication"] as const) {
      for (const item of station.grille[axis]) {
        if (!item.scoringRule) continue;
        const parsed = presTest.parseScoringRule(item.scoringRule, item.id);
        modes.add(parsed.mode);
      }
    }
    // Cohérent avec arbitrage utilisateur : « token-based : non pertinent
    // pour RESCOS-72 (cas spécifique p3 RESCOS-64-P2) ».
    expect(modes.has("count")).toBe(true);
    expect(modes.has("token")).toBe(false);
  });
});

describe("Phase 8 J4 — non-régression scoring legal sur RESCOS-72", () => {
  it("evaluateLegal retourne 4 axes Phase 5/7 stable (la grille n'altère PAS le scoring legal)", async () => {
    const result = await evaluateLegal({
      stationId: "RESCOS-72",
      transcript:
        "Je ne peux pas vous délivrer ce certificat, ce serait un faux. L'art. 318 du CP s'applique. Le secret professionnel est maintenu (art. 321). Je vous propose d'aller voir votre employeur pour discuter d'un congé sans solde.",
    });
    expect(result.stationId).toBe("RESCOS-72");
    expect(result.category).toBe("certificat_complaisance");
    expect(Object.keys(result.axes).sort()).toEqual([
      "communication",
      "decision",
      "reconnaissance",
      "verbalisation",
    ]);
    // Score chaque axe est entre 0 et 100.
    for (const axis of Object.keys(result.axes) as Array<keyof typeof result.axes>) {
      expect(result.axes[axis].score_pct).toBeGreaterThanOrEqual(0);
      expect(result.axes[axis].score_pct).toBeLessThanOrEqual(100);
    }
    expect(result.lexiconVersion).toBe("1.1.0");
  });
});

describe("Phase 8 J4 — non-régression brief HTTP RESCOS-72 (baseline 717 bytes UTF-8)", () => {
  it("getPatientBrief(RESCOS-72) = 717 bytes UTF-8 (Phase 7 baseline préservée)", async () => {
    const brief = await getPatientBrief("RESCOS-72");
    const json = JSON.stringify(brief);
    const bytes = Buffer.byteLength(json, "utf-8");
    expect(bytes).toBe(717);
  });

  it("brief RESCOS-72 ne contient AUCUN champ médico-légal interne (META_FIELDS_TO_STRIP)", async () => {
    const brief = await getPatientBrief("RESCOS-72");
    const json = JSON.stringify(brief);
    expect(json).not.toContain("legalContext");
    expect(json).not.toContain("medicoLegalReviewed");
    expect(json).not.toContain("parentStationId");
  });

  it("GET /api/patient/RESCOS-72/brief : 200 + 717 bytes UTF-8", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-72/brief");
    expect(res.status).toBe(200);
    const bytes = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
    expect(bytes).toBe(717);
  });
});

describe("Phase 8 J4 — non-régression endpoint /api/debug/evaluation-weights sur RESCOS-72", () => {
  it("RESCOS-72 retourne 6 axes pondérés Phase 7 J2 (medico_legal=10 + 5 axes proportionnels × 0.9)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/debug/evaluation-weights?stationId=RESCOS-72");
    expect(res.status).toBe(200);
    expect(res.body.stationId).toBe("RESCOS-72");
    expect(res.body.hasLegalContext).toBe(true);
    // 6e axe medico_legal = 10 (Phase 7 J2, présent car legalContext défini).
    expect(res.body.weights.medico_legal).toBe(10);
    // Somme des 6 axes = 100 (invariant Phase 7 J2 préservé).
    expect(res.body.sumWeights).toBeCloseTo(100, 5);
  });
});
