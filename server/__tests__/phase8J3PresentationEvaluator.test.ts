// Phase 8 J3 — tests de l'évaluateur partie 2 (présentation orale).
//
// Couvre :
//   • Service `presentationEvaluator` — heuristique pure, ZÉRO LLM.
//     Helpers fins (normalizeText, detectMention, extractDiagnostic,
//     splitCsvItems, parseScoringRule, applyScoringRule).
//   • Endpoint POST /api/evaluation/presentation — validation Zod,
//     codes HTTP (200, 400, 404), corps réponse complet.
//   • Cas spéciaux Phase A J3 (arbitrages utilisateur) :
//       — β fractional sur items binary:F sans rule (Ambiguïté A)
//       — extraction diagnostic du text axe raisonnement (Ambiguïté B)
//       — skip silent r14 « Aucun » (Ambiguïté C)
//       — recalibration max scoringRule si nbExpected < ruleMax (p4/p5/p7)
//       — token-based scoringRule (p3)
//       — console.warn une fois sur scoringRule unparsable
//   • Idempotence + non-régression (parentStationId jamais leaké, pas
//     d'appel à legalEvaluator).

import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { initCatalog } from "../services/stationsService";
import {
  evaluatePresentation,
  PRESENTATION_WEIGHTS,
  __test__ as presTest,
} from "../services/presentationEvaluator";
import { getEvaluatorStation } from "../services/evaluatorService";
import { buildTestApp } from "./helpers";

beforeAll(async () => {
  await initCatalog();
});

beforeEach(() => {
  presTest.resetWarnings();
});

// ────────────────────────────────────────────────────────────────────────
// Helpers fins (zéro setup catalog)

describe("Phase 8 J3 — normalizeText", () => {
  const f = presTest.normalizeText;

  it("strip accents + lowercase", () => {
    expect(f("Hémoptysie")).toBe("hemoptysie");
    expect(f("Tabagisme actif à 35 UPA")).toBe("tabagisme actif a 35 upa");
  });

  it("ponctuation → espaces normalisés", () => {
    expect(f("Toux, dyspnée; douleur!")).toBe("toux dyspnee douleur");
  });
});

describe("Phase 8 J3 — detectMention (substring + keyword 60%)", () => {
  const f = presTest.detectMention;

  it("substring direct (chemin rapide)", () => {
    expect(f("Tuberculose", "Le patient présente une tuberculose")).toBe(true);
  });

  it("keyword match ≥60% (BPCO synonyme)", () => {
    // "Probable BPCO" : keywords ≥4 lettres = ['probable', 'bpco'] (4 chars).
    // Transcript contient "bpco" → 1/2 = 50%, ceil(2*0.6)=2 → 1<2 → false.
    // Test du seuil 60% : doit échouer en dessous.
    expect(f("Probable BPCO mention", "Le patient a une BPCO")).toBe(false);
  });

  it("keyword match ≥60% atteint avec 2 mots significatifs", () => {
    // "douleur thoracique" : keywords = ['douleur', 'thoracique'] = 2 mots.
    // Transcript "douleur thoracique" → 2/2 = 100% → true.
    expect(f("douleur thoracique", "Le patient a une douleur thoracique")).toBe(true);
  });

  it("aucun match → false", () => {
    expect(f("Tuberculose", "Bonjour merci au revoir")).toBe(false);
  });

  // Limite documentée Phase 9 : ne distingue pas affirmation/négation.
  it("limite affirmation/négation : « pas de tuberculose » match positif (faux positif documenté)", () => {
    expect(f("Tuberculose", "pas de tuberculose")).toBe(true);
  });

  it("limite : « tuberculose absente » match positif (faux positif documenté)", () => {
    expect(f("Tuberculose", "tuberculose absente")).toBe(true);
  });

  it("vrai positif : « le patient présente une tuberculose »", () => {
    expect(f("Tuberculose", "le patient présente une tuberculose")).toBe(true);
  });
});

describe("Phase 8 J3 — extractDiagnostic (Ambiguïté B option B1)", () => {
  const f = presTest.extractDiagnostic;

  it("« Diagnostic le plus probable: X » → X", () => {
    expect(f("Diagnostic le plus probable: Cancer pulmonaire")).toBe("Cancer pulmonaire");
  });

  it("« Diagnostic différentiel: Y »  → Y", () => {
    expect(f("Diagnostic différentiel: Tuberculose")).toBe("Tuberculose");
  });

  it("texte sans pattern Diagnostic → null", () => {
    expect(f("Auscultation pulmonaire normale")).toBe(null);
  });
});

describe("Phase 8 J3 — splitCsvItems", () => {
  const f = presTest.splitCsvItems;

  it("split sur virgules + trim", () => {
    expect(f("Toux, dyspnée, perte pondérale")).toEqual([
      "Toux",
      "dyspnée",
      "perte pondérale",
    ]);
  });

  it("string sans virgule → 1 sous-élément", () => {
    expect(f("Tabagisme actif à 35 UPA")).toEqual(["Tabagisme actif à 35 UPA"]);
  });

  it("string vide → tableau vide", () => {
    expect(f("")).toEqual([]);
  });
});

describe("Phase 8 J3 — parseScoringRule (3 modes)", () => {
  const f = presTest.parseScoringRule;

  it("mode count : « 4-6 = 3 pts, 2-3 = 1 pt, 0-1 = 0 pt »", () => {
    const parsed = f("4-6 = 3 pts, 2-3 = 1 pt, 0-1 = 0 pt", "r2");
    expect(parsed.mode).toBe("count");
    expect(parsed.steps).toHaveLength(3);
    // Tri décroissant par count.
    expect(parsed.steps[0]).toMatchObject({ kind: "count", count: 4, points: 3 });
    expect(parsed.steps[1]).toMatchObject({ kind: "count", count: 2, points: 1 });
    expect(parsed.steps[2]).toMatchObject({ kind: "count", count: 0, points: 0 });
  });

  it("mode count : alias-binaire « Fait = 2 pts, ± = 1 pt, Pas fait = 0 pt »", () => {
    const parsed = f("Fait = 2 pts, ± = 1 pt, Pas fait = 0 pt", "r16");
    expect(parsed.mode).toBe("count");
    expect(parsed.steps).toHaveLength(3);
    // Alias mappés : Fait→count=1, ±→count=1, Pas fait→count=0.
    const counts = parsed.steps.map((s) => (s as { count: number }).count);
    expect(counts).toContain(1);
    expect(counts).toContain(0);
  });

  it("mode token : « Toux = 1 pt, dyspnée = 1 pt » → 2 steps token", () => {
    const parsed = f("Toux = 1 pt, dyspnée = 1 pt", "p3");
    expect(parsed.mode).toBe("token");
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0]).toMatchObject({ kind: "token", token: "Toux", points: 1 });
    expect(parsed.steps[1]).toMatchObject({ kind: "token", token: "dyspnée", points: 1 });
  });

  it("warn une fois sur scoringRule entièrement unparsable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    f("format inconnu xyz", "fake-item-1");
    f("format inconnu xyz", "fake-item-1"); // 2e appel : pas de warn
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/scoringRule unparsable on item fake-item-1/);
    warn.mockRestore();
  });

  it("pas de warn pour rule parsable mode count", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    f("4-6 = 3 pts, 2-3 = 1 pt, 0-1 = 0 pt", "r2-test");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("pas de warn pour rule parsable mode token", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    f("Toux = 1 pt, dyspnée = 1 pt", "p3-test");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("Phase 8 J3 — applyScoringRule (mode count + recalibration max)", () => {
  const f = presTest.applyScoringRule;
  const parse = presTest.parseScoringRule;

  it("p4 (csv=1, rule 2 él=2 pts/1 él=1 pt) → max recalibré à 1", () => {
    const parsed = parse("2 éléments = 2 pts, 1 élément = 1 pt", "p4-test");
    const result = f(parsed, 1, "transcript", 1);
    expect(result.max).toBe(1); // recalibration : count:2 inatteignable car expected=1
    expect(result.score).toBe(1);
  });

  it("p4 (csv=1) avec matched=0 → score=0 max=1", () => {
    const parsed = parse("2 éléments = 2 pts, 1 élément = 1 pt", "p4-test");
    const result = f(parsed, 0, "transcript", 1);
    expect(result.max).toBe(1);
    expect(result.score).toBe(0);
  });

  it("r2 (csv=5, rule 4-6=3/2-3=1/0-1=0) → max nominal=3 (pas recalibré)", () => {
    const parsed = parse("4-6 = 3 pts, 2-3 = 1 pt, 0-1 = 0 pt", "r2-test");
    const result = f(parsed, 5, "transcript", 5);
    expect(result.max).toBe(3); // expected=5 ≥ ruleMax=4 → max nominal préservé
    expect(result.score).toBe(3);
  });

  it("r2 avec matched=2 (clause 2-3=1pt)", () => {
    const parsed = parse("4-6 = 3 pts, 2-3 = 1 pt, 0-1 = 0 pt", "r2-test");
    const result = f(parsed, 2, "transcript", 5);
    expect(result.score).toBe(1);
    expect(result.max).toBe(3);
  });
});

describe("Phase 8 J3 — applyScoringRule (mode token, cas p3)", () => {
  const f = presTest.applyScoringRule;
  const parse = presTest.parseScoringRule;

  it("p3 token mode max=2 (somme des points)", () => {
    const parsed = parse("Toux = 1 pt, dyspnée = 1 pt", "p3-test");
    const result = f(parsed, 0, "Toux et dyspnée", 0);
    expect(result.max).toBe(2);
    expect(result.score).toBe(2);
  });

  it("p3 score=1 sur transcript « toux seulement »", () => {
    const parsed = parse("Toux = 1 pt, dyspnée = 1 pt", "p3-test");
    const result = f(parsed, 0, "le patient a une toux", 0);
    expect(result.score).toBe(1);
    expect(result.max).toBe(2);
  });

  it("p3 score=0 sur transcript vide narrativement", () => {
    const parsed = parse("Toux = 1 pt, dyspnée = 1 pt", "p3-test");
    const result = f(parsed, 0, "Bonjour merci au revoir", 0);
    expect(result.score).toBe(0);
    expect(result.max).toBe(2);
  });

  it("p3 score=1 sur « Toux toux toux » (déduplication par token)", () => {
    // Détection : Toux mentionné (oui), dyspnée (non). Score=1+0=1.
    const parsed = parse("Toux = 1 pt, dyspnée = 1 pt", "p3-test");
    const result = f(parsed, 0, "Toux toux toux", 0);
    expect(result.score).toBe(1);
    expect(result.max).toBe(2);
  });

  it("p3 score=2 sur « dyspnée et toux » (ordre sans importance)", () => {
    const parsed = parse("Toux = 1 pt, dyspnée = 1 pt", "p3-test");
    const result = f(parsed, 0, "dyspnée et toux", 0);
    expect(result.score).toBe(2);
    expect(result.max).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────────────
// evaluatePresentation — service haut niveau (catalog + grille réelle)

describe("Phase 8 J3 — evaluatePresentation (service)", () => {
  it("erreur si station inexistante (PresentationEvaluatorStationNotFoundError)", async () => {
    await expect(
      evaluatePresentation({ stationId: "FAKE-XYZ", transcript: "x" }),
    ).rejects.toThrow(/introuvable/);
  });

  it("erreur si station partie 1 sans parentStationId (PresentationEvaluatorNotPart2Error)", async () => {
    await expect(
      evaluatePresentation({ stationId: "RESCOS-64", transcript: "x" }),
    ).rejects.toThrow(/n'est pas une partie 2/);
  });

  it("RESCOS-64-P2 retourne 4 axes nommés exactement", async () => {
    const result = await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript: "x",
    });
    expect(Object.keys(result.axes).sort()).toEqual([
      "examens",
      "management",
      "presentation",
      "raisonnement",
    ]);
  });

  it("weights = 4 × 0.25 (somme = 1.0 exact)", async () => {
    const result = await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript: "x",
    });
    expect(result.weights).toEqual({
      presentation: 0.25,
      raisonnement: 0.25,
      examens: 0.25,
      management: 0.25,
    });
    expect(PRESENTATION_WEIGHTS.presentation
      + PRESENTATION_WEIGHTS.raisonnement
      + PRESENTATION_WEIGHTS.examens
      + PRESENTATION_WEIGHTS.management).toBe(1.0);
  });

  it("weightedScore ∈ [0, 100] sur transcript arbitraire", async () => {
    const result = await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript: "Bonjour examinateur, voici ma présentation.",
    });
    expect(result.weightedScore).toBeGreaterThanOrEqual(0);
    expect(result.weightedScore).toBeLessThanOrEqual(100);
  });

  it("transcript narrativement vide → weightedScore = 0", async () => {
    const result = await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript: "Bonjour. Voici ma présentation. Merci.",
    });
    expect(result.weightedScore).toBe(0);
  });

  it("idempotence : 2 appels avec même input → même résultat", async () => {
    const transcript = "Le patient présente une toux et une dyspnée importantes.";
    const r1 = await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript,
    });
    const r2 = await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript,
    });
    expect(r1.weightedScore).toBe(r2.weightedScore);
    expect(JSON.stringify(r1.axes)).toBe(JSON.stringify(r2.axes));
  });

  it("r14 (« Aucun ») skip silent : ne contribue ni au score ni au max raisonnement", async () => {
    const result = await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript: "Argument pour la sténose mitrale : aucun.",
    });
    const r14 = result.axes.raisonnement.items.find((i) => i.id === "r14");
    expect(r14).toBeDefined();
    expect(r14!.skipped).toBe(true);
    expect(r14!.score).toBe(0);
    expect(r14!.max).toBe(0);
  });

  it("p4/p5/p7 max recalibré = 1 (Q(a) recalibration)", async () => {
    const result = await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript: "Tabagisme. Douleur thoracique respiro-dépendante. Perte pondérale.",
    });
    const p4 = result.axes.presentation.items.find((i) => i.id === "p4");
    const p5 = result.axes.presentation.items.find((i) => i.id === "p5");
    const p7 = result.axes.presentation.items.find((i) => i.id === "p7");
    expect(p4!.max).toBe(1);
    expect(p5!.max).toBe(1);
    expect(p7!.max).toBe(1);
  });

  it("r2 (csv=5 ruleMax=4) max nominal=3 préservé (pas de recalibration)", async () => {
    const result = await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript: "x",
    });
    const r2 = result.axes.raisonnement.items.find((i) => i.id === "r2");
    expect(r2!.max).toBe(3);
  });

  it("p3 token mode : max=2 dans la réponse", async () => {
    const result = await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript: "x",
    });
    const p3 = result.axes.presentation.items.find((i) => i.id === "p3");
    expect(p3!.max).toBe(2);
  });

  it("transcript parfait (concat tous items_attendus + diagnostics + tokens p3) → weightedScore = 100", async () => {
    // Construit le transcript "parfait" depuis la grille réelle. Cohérent
    // avec les arbitrages utilisateur Phase A (β + B1 + C3 + recalibration
    // + token mode).
    const evalStation = await getEvaluatorStation("RESCOS-64-P2");
    const grille = (evalStation as { grille: Record<string, Array<{
      id: string; text: string; binaryOnly?: boolean;
      scoringRule?: string; items_attendus?: string[];
    }>> }).grille;
    const parts: string[] = [];
    for (const axis of ["presentation", "raisonnement", "examens", "management"] as const) {
      for (const item of grille[axis]) {
        const itemsAttendus = item.items_attendus ?? [];
        if (itemsAttendus.length === 1 && /^aucun$/i.test(itemsAttendus[0].trim())) continue;
        if (item.binaryOnly === true && itemsAttendus.length === 0 && axis === "raisonnement") {
          const diag = presTest.extractDiagnostic(item.text);
          if (diag) parts.push(diag);
          continue;
        }
        if (itemsAttendus.length === 0) continue;
        parts.push(itemsAttendus[0]);
        if (item.scoringRule && item.binaryOnly !== true) {
          const parsed = presTest.parseScoringRule(item.scoringRule, item.id);
          if (parsed.mode === "token") {
            for (const step of parsed.steps) {
              if (step.kind === "token") parts.push((step as { token: string }).token);
            }
          }
        }
      }
    }
    const transcript = parts.join(". ") + ".";
    const result = await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript,
    });
    expect(result.weightedScore).toBe(100);
  });

  it("réponse JSON ne fuite pas de champs « id internes » au-delà de stationId/parentStationId", async () => {
    const result = await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript: "x",
    });
    // parentStationId est exposé volontairement dans la réponse (transparence
    // utilisateur). Mais la valeur DOIT être le shortId résolu, pas un fullId.
    expect(result.parentStationId).toBe("RESCOS-64");
    expect(result.stationId).toBe("RESCOS-64-P2");
  });
});

// ────────────────────────────────────────────────────────────────────────
// Endpoint POST /api/evaluation/presentation

describe("Phase 8 J3 — POST /api/evaluation/presentation (HTTP)", () => {
  it("200 sur RESCOS-64-P2 avec transcript valide", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/presentation")
      .send({ stationId: "RESCOS-64-P2", transcript: "Le patient présente." });
    expect(res.status).toBe(200);
    expect(res.body.stationId).toBe("RESCOS-64-P2");
    expect(res.body.parentStationId).toBe("RESCOS-64");
    expect(typeof res.body.weightedScore).toBe("number");
  });

  it("404 sur stationId inexistant", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/presentation")
      .send({ stationId: "FAKE-INEXISTANT", transcript: "x" });
    expect(res.status).toBe(404);
  });

  it("400 sur stationId partie 1 sans parentStationId (RESCOS-64)", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/presentation")
      .send({ stationId: "RESCOS-64", transcript: "x" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
    // sendApiError (server/lib/errors.ts) expose { error, code, hint }.
    // Le message principal est dans `error`, le détail dans `hint`.
    expect(`${res.body.error} ${res.body.hint ?? ""}`).toMatch(/partie 2|parentStationId/i);
  });

  it("400 sur transcript vide", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/presentation")
      .send({ stationId: "RESCOS-64-P2", transcript: "" });
    expect(res.status).toBe(400);
  });

  it("400 sur body sans stationId", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/presentation")
      .send({ transcript: "x" });
    expect(res.status).toBe(400);
  });

  it("réponse contient les 4 axes nommés + weights 4×0.25", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/presentation")
      .send({ stationId: "RESCOS-64-P2", transcript: "x" });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.axes).sort()).toEqual([
      "examens",
      "management",
      "presentation",
      "raisonnement",
    ]);
    expect(res.body.weights).toEqual({
      presentation: 0.25,
      raisonnement: 0.25,
      examens: 0.25,
      management: 0.25,
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Isolation : pas d'appel à legalEvaluator depuis presentationEvaluator

describe("Phase 8 J3 — isolation : pas d'appel à legalEvaluator", () => {
  it("evaluatePresentation N'INVOQUE PAS evaluateLegal", async () => {
    // Spy sur l'export du module legalEvaluator. Si presentationEvaluator
    // s'égarait à appeler evaluateLegal, ce spy serait incrémenté.
    const legalMod = await import("../services/legalEvaluator");
    const spy = vi.spyOn(legalMod, "evaluateLegal");
    await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript: "Toux et dyspnée.",
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
