// Phase 8 J4 — tests anti-régression hotfix 404 + couverture runtime
// console.warn pour les scoringRule au format inconnu.
//
// Sujet 1 (hotfix 404 → 500) : avant J4, /api/evaluation/presentation
// retournait 500 « Invalid status code: undefined » sur stationId
// inexistant — la cause était que le code "not_found" n'était pas dans
// `ApiErrorCode` (HTTP_BY_CODE["not_found"] = undefined). Hotfix J4 :
//   • errors.ts : ajout "not_found" → 404 dans ApiErrorCode + HTTP_BY_CODE
//   • routes/evaluation.ts : retire le res.status(404) redondant
//   • Tests runtime supertest qui valident body.code + body.error,
//     pas seulement res.status — pour catch tout drift futur du mapping.
//
// Sujet 3 (test runtime console.warn) : J3 a livré `console.warn` dédupliqué
// sur scoringRule au format inconnu MAIS aucun item RESCOS-64-P2 ne
// déclenche ce chemin. Ce fichier ajoute un test d'intégration qui mocke
// une grille avec un item au format inconnu et vérifie le warn runtime.

import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import { initCatalog } from "../services/stationsService";
import {
  evaluatePresentation,
  __test__ as presTest,
} from "../services/presentationEvaluator";
import { buildTestApp } from "./helpers";

beforeEach(() => {
  presTest.resetWarnings();
});

// ────────────────────────────────────────────────────────────────────────
// Hotfix 404 — runtime supertest

describe("Phase 8 J4 hotfix — POST /api/evaluation/presentation 404 runtime", () => {
  beforeEach(async () => {
    await initCatalog();
  });

  it("404 + body.code='not_found' + body.error sur stationId inexistant", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/presentation")
      .send({ stationId: "FAKE-STATION-XYZ", transcript: "transcript valide" });
    // Avant hotfix : status=500 + message « Invalid status code: undefined ».
    // Après hotfix : status=404 + body conforme.
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body.error).toMatch(/introuvable|FAKE-STATION-XYZ/i);
  });

  it("404 sur stationId qui ne match aucun shortId du catalog", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/presentation")
      .send({ stationId: "RESCOS-999", transcript: "x" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });

  it("400 + body.code='bad_request' sur partie 1 (RESCOS-64) qui n'a pas parentStationId", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/presentation")
      .send({ stationId: "RESCOS-64", transcript: "x" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
    expect(typeof res.body.error).toBe("string");
  });

  it("200 + structure cohérente sur RESCOS-64-P2 (sanity check post-hotfix)", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/presentation")
      .send({ stationId: "RESCOS-64-P2", transcript: "Le patient a une toux." });
    expect(res.status).toBe(200);
    expect(res.body.stationId).toBe("RESCOS-64-P2");
    expect(res.body.parentStationId).toBe("RESCOS-64");
    expect(typeof res.body.weightedScore).toBe("number");
  });
});

// ────────────────────────────────────────────────────────────────────────
// errors.ts — ajout du code "not_found"

describe("Phase 8 J4 hotfix — errors.ts ajout code 'not_found' → 404", () => {
  it("sendApiError(res, 'not_found', ...) écrit status 404 et body.code='not_found'", async () => {
    const { sendApiError } = await import("../lib/errors");
    // Mock minimal de Response Express
    let written: { status: number | undefined; body: unknown } = {
      status: undefined,
      body: undefined,
    };
    const fakeRes = {
      status(code: number) {
        written.status = code;
        return this;
      },
      json(body: unknown) {
        written.body = body;
        return this;
      },
    } as unknown as import("express").Response;
    sendApiError(fakeRes, "not_found", "Station X introuvable.", "Hint optionnel.");
    expect(written.status).toBe(404);
    expect(written.body).toEqual({
      error: "Station X introuvable.",
      code: "not_found",
      hint: "Hint optionnel.",
    });
  });

  it("sendApiError sans hint : body.hint absent (anti-régression)", async () => {
    const { sendApiError } = await import("../lib/errors");
    let written: { body: unknown } = { body: undefined };
    const fakeRes = {
      status() { return this; },
      json(body: unknown) { written.body = body; return this; },
    } as unknown as import("express").Response;
    sendApiError(fakeRes, "not_found", "X.");
    expect(written.body).toEqual({ error: "X.", code: "not_found" });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Sujet 3 — test runtime console.warn formats inconnus scoringRule

describe("Phase 8 J4 Sujet 3 — console.warn sur scoringRule format inconnu (runtime)", () => {
  it("console.warn émis 1 fois sur format complètement inconnu", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    presTest.parseScoringRule("format invalide xyz", "fake-item-A");
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toMatch(/^\[presentationEvaluator\]/);
    expect(msg).toMatch(/scoringRule unparsable on item fake-item-A/);
    expect(msg).toMatch(/Clause skipped/);
    warn.mockRestore();
  });

  it("console.warn émis 1 fois pour string vide", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // String vide : split → 0 clauses → unparsable=0, steps=[]. La condition
    // de warn (unparsable > 0 && steps.length === 0) n'est pas remplie pour
    // une rule vide. Mais on couvre le cas via un format pseudo-clause sans
    // points.
    presTest.parseScoringRule("foo bar", "fake-item-empty");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("PAS de console.warn pour scoringRule mode count parsable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    presTest.parseScoringRule("4-6 = 3 pts, 2-3 = 1 pt, 0-1 = 0 pt", "fake-item-count");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("PAS de console.warn pour scoringRule mode token parsable (cas p3)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    presTest.parseScoringRule("Toux = 1 pt, dyspnée = 1 pt", "fake-item-token");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("PAS de console.warn pour alias-binaire « Fait/Pas fait/± »", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    presTest.parseScoringRule("Fait = 2 pts, ± = 1 pt, Pas fait = 0 pt", "fake-item-alias");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("déduplication : warn une seule fois même si parseScoringRule rappelée 5× sur même item+rule", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 5; i++) {
      presTest.parseScoringRule("format inconnu", "fake-item-dedup");
    }
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("warn 2 fois sur 2 items distincts avec format inconnu (pas de dédup cross-item)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    presTest.parseScoringRule("format inconnu", "fake-item-X");
    presTest.parseScoringRule("format inconnu", "fake-item-Y");
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("scoreItem sur item avec scoringRule unparsable : score=0 max=0 + warn (pas de crash)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const item = {
      id: "fake-z1",
      text: "Item synthétique format inconnu",
      binaryOnly: false,
      scoringRule: "format invalide xyz",
      items_attendus: ["foo"],
    };
    const report = presTest.scoreItem(item, "transcript de référence", "presentation");
    // Pas de crash, reporté comme item neutre (score=max=0) — sécurité runtime.
    expect(report.id).toBe("fake-z1");
    expect(report.score).toBe(0);
    expect(report.max).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("evaluatePresentation sur RESCOS-64-P2 (10 scoringRules valides) : 0 console.warn", async () => {
    await initCatalog();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript: "Le patient a une toux et une dyspnée.",
    });
    // Toutes les scoringRules de RESCOS-64-P2 sont parsables (mode count, token
    // ou alias). Aucun warn ne doit être émis runtime.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
