// Phase 9 J4 — tests UI :
//   • Bug 1 : parité poids HTML/PDF sur RESCOS-72 (legalContext rééchelonné).
//     Inversion priorité buildDisplaySections : existing.weight (backend
//     dynamique) prime sur canonicalPercent (table statique base v1).
//   • Dette 7 : bilan combiné stations doubles (RESCOS-64-P2). Bandeau,
//     score combiné 60/40, sections P1 + P2, fallback dégradé si P1 absent.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import Evaluation, {
  buildDisplaySections,
  combinedGlobalScore,
} from "./Evaluation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import type {
  EvaluationResult,
  EvaluationWeightsResponse,
  PresentationEvaluation,
  StationType,
} from "@/lib/api";
import { part1EvalStorageKey } from "@/lib/part1Evaluation";

// On évite de rendre le PDF complet pendant les tests (alourdirait happy-dom
// inutilement). Bug 1 est testé directement sur AxisRow / buildDisplaySections
// — le PDF rend `s.weight` via `Math.round(weight * 100)` de la même façon
// que le HTML après inversion J4.
vi.mock("@/components/ReportPdf", () => ({
  ReportPdf: () => null,
}));

const PHASE2_WEIGHTS_PAYLOAD: EvaluationWeightsResponse = {
  axes: ["anamnese", "examen", "management", "cloture", "communication"],
  weights: {
    anamnese_examen:        { anamnese: 25, examen: 25, management: 25, cloture: 25, communication: 0 },
    bbn:                    { anamnese: 15, examen: 5, management: 15, cloture: 25, communication: 40 },
    psy:                    { anamnese: 25, examen: 5, management: 20, cloture: 20, communication: 30 },
    pediatrie_accompagnant: { anamnese: 25, examen: 20, management: 20, cloture: 15, communication: 20 },
    teleconsultation:       { anamnese: 35, examen: 5, management: 30, cloture: 15, communication: 15 },
    triage:                 { anamnese: 30, examen: 20, management: 35, cloture: 10, communication: 5 },
  },
};

function ok(json: unknown): Response {
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function bad(status: number, code: string, msg: string): Response {
  return new Response(JSON.stringify({ error: msg, code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchWithWeights(
  handler: (url: string) => Response | Promise<Response>,
): (url: RequestInfo | URL) => Promise<Response> {
  return async (url: RequestInfo | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.endsWith("/api/evaluator/weights")) return ok(PHASE2_WEIGHTS_PAYLOAD);
    if (u.endsWith("/api/evaluation/legal")) {
      try {
        return await handler(u);
      } catch {
        return bad(400, "bad_request", "Station ne déclare pas de legalContext.");
      }
    }
    return handler(u);
  };
}

const baseBriefFixture = {
  setting: "",
  patientDescription: "",
  vitals: {},
  phraseOuverture: "",
  sex: "female" as const,
  age: 47,
  interlocutor: { type: "self" as const, reason: "adult" },
};

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ────────────────────────────────────────────────────────────────────────
// Bug 1 — buildDisplaySections : inversion priorité (existing.weight prime)
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J4 — Bug 1 : buildDisplaySections (priorité existing.weight sur canonicalPercent)", () => {
  it("RESCOS-72 (legalContext rééchelonné) : 4 axes principaux à weight=0.225 → returnent 0.225 (≠ table v1 0.25)", () => {
    // Cas reproduisant le runtime RESCOS-72 (anamnese_examen + legalContext).
    // sections[].weight vient de getEffectiveAxisWeights backend = base × 0.9.
    const sections: EvaluationResult["scores"]["sections"] = [
      { key: "anamnese", name: "Anamnèse", weight: 0.225, score: 80 },
      { key: "examen", name: "Examen", weight: 0.225, score: 70 },
      { key: "management", name: "Management", weight: 0.225, score: 60 },
      { key: "cloture", name: "Clôture", weight: 0.225, score: 50 },
      { key: "communication", name: "Communication", weight: 0, score: 0 },
    ];
    const out = buildDisplaySections(sections, PHASE2_WEIGHTS_PAYLOAD, "anamnese_examen");
    // Bug 1 invariant 1 : existing.weight prime sur canonicalPercent.
    // buildDisplaySections arrondit d'abord (Math.round(0.225 * 100) = 23)
    // puis re-divise par 100 → weight=0.23 (cohérent avec ce qui est
    // affiché en %). Le PDF de son côté lit `scores.sections[].weight`
    // brut (0.225) et arrondit aussi à 23%. Cible parité côté affichage
    // entier : 23 == 23, byte-à-byte.
    expect(Math.round(out[0].weight * 100)).toBe(23);
    expect(Math.round(out[1].weight * 100)).toBe(23);
    expect(Math.round(out[2].weight * 100)).toBe(23);
    expect(Math.round(out[3].weight * 100)).toBe(23);
    expect(Math.round(out[4].weight * 100)).toBe(0);
    // Garde-fou : SURTOUT pas 25 % (ancien comportement pré-J4 où la
    // table statique 25/25/25/25 primait sur existing.weight 0.225).
    expect(Math.round(out[0].weight * 100)).not.toBe(25);
  });

  it("station classique sans legalContext : weight=0.25 → returne 0.25 (table v1 préservée)", () => {
    const sections: EvaluationResult["scores"]["sections"] = [
      { key: "anamnese", name: "Anamnèse", weight: 0.25, score: 80 },
      { key: "examen", name: "Examen", weight: 0.25, score: 70 },
      { key: "management", name: "Management", weight: 0.25, score: 60 },
      { key: "cloture", name: "Clôture", weight: 0.25, score: 50 },
      { key: "communication", name: "Communication", weight: 0, score: 0 },
    ];
    const out = buildDisplaySections(sections, PHASE2_WEIGHTS_PAYLOAD, "anamnese_examen");
    expect(Math.round(out[0].weight * 100)).toBe(25);
    expect(Math.round(out[1].weight * 100)).toBe(25);
    expect(Math.round(out[2].weight * 100)).toBe(25);
    expect(Math.round(out[3].weight * 100)).toBe(25);
    expect(Math.round(out[4].weight * 100)).toBe(0);
  });

  it("axe absent de sections (cas pathologique LLM) : fallback canonicalPercent fonctionne", () => {
    // Cas hallucination Sonnet : Clôture absente. Le fallback table v1
    // synthétise la rangée avec poids canonique base v1 (25 % ici) — c'est
    // le comportement de robustesse Phase 2/3 préservé.
    const sections: EvaluationResult["scores"]["sections"] = [
      { key: "anamnese", name: "Anamnèse", weight: 0.225, score: 80 },
      { key: "examen", name: "Examen", weight: 0.225, score: 70 },
      { key: "management", name: "Management", weight: 0.225, score: 60 },
      // cloture absent → fallback canonicalPercent[cloture] = 25
    ];
    const out = buildDisplaySections(sections, PHASE2_WEIGHTS_PAYLOAD, "anamnese_examen");
    const cloture = out.find((s) => s.key === "cloture");
    expect(cloture).toBeDefined();
    expect(Math.round(cloture!.weight * 100)).toBe(25);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Bug 1 — rendu HTML : RESCOS-72 affiche 23 % (parité PDF)
// ────────────────────────────────────────────────────────────────────────

function buildLegalResultRescos72(): EvaluationResult {
  return {
    markdown: "# Rapport RESCOS-72\n",
    scores: {
      globalScore: 72,
      sections: [
        { key: "anamnese", name: "Anamnèse", weight: 0.225, score: 80 },
        { key: "examen", name: "Examen", weight: 0.225, score: 70 },
        { key: "management", name: "Management", weight: 0.225, score: 60 },
        { key: "cloture", name: "Clôture", weight: 0.225, score: 50 },
        { key: "communication", name: "Communication", weight: 0, score: 0 },
      ],
      verdict: "Réussi",
    },
    stationType: "anamnese_examen",
    communicationWeight: 0,
    medicoLegalScore: 82,
    medicoLegalWeight: 10,
  };
}

function renderClassic() {
  const stationId = "RESCOS-72";
  sessionStorage.setItem(
    `osce.session.${stationId}`,
    JSON.stringify({
      stationId,
      brief: { ...baseBriefFixture, stationId },
      transcript: [
        { role: "doctor", text: "Bonjour" },
        { role: "patient", text: "Bonjour docteur" },
      ],
    }),
  );
  window.history.pushState({}, "", `/evaluation?station=${stationId}`);
  const { hook } = memoryLocation({ path: `/evaluation?station=${stationId}`, static: false });
  return render(
    <Router hook={hook}>
      <TooltipProvider>
        <Toaster />
        <Evaluation />
      </TooltipProvider>
    </Router>,
  );
}

describe("Phase 9 J4 — Bug 1 : rendu HTML RESCOS-72 (legalContext rééchelonné)", () => {
  it("RESCOS-72 : 4 axes principaux affichent « poids 23% » (PARITÉ PDF — Bug 1 résolu)", async () => {
    const fetchMock = vi.fn(fetchWithWeights((u) => {
      if (u.endsWith("/api/evaluator/evaluate")) return ok(buildLegalResultRescos72());
      throw new Error(`Unexpected fetch to ${u}`);
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderClassic();

    await waitFor(() => expect(screen.getByTestId("score-anamnese")).toBeDefined());
    for (const axis of ["anamnese", "examen", "management", "cloture"] as const) {
      const row = screen.getByTestId(`score-${axis}`);
      expect(row.textContent, `${axis} HTML doit afficher "poids 23%" (parité PDF)`).toContain("poids 23%");
      // Garde-fou anti-régression : surtout PAS 25%.
      expect(row.textContent, `${axis} ne doit pas afficher "poids 25%"`).not.toContain("poids 25%");
    }
  });

  it("RESCOS-72 : axe medico_legal affiche « poids 10% »", async () => {
    const fetchMock = vi.fn(fetchWithWeights((u) => {
      if (u.endsWith("/api/evaluator/evaluate")) return ok(buildLegalResultRescos72());
      throw new Error(`Unexpected fetch to ${u}`);
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderClassic();

    await waitFor(() => expect(screen.getByTestId("score-medico_legal")).toBeDefined());
    const row = screen.getByTestId("score-medico_legal");
    expect(row.textContent).toContain("(poids 10%)");
    expect(row.textContent).toContain("82%");
  });

  it("station classique anamnese_examen sans legalContext : 25 % préservé (non-régression)", async () => {
    const classicResult: EvaluationResult = {
      markdown: "# Rapport\n",
      scores: {
        globalScore: 72,
        sections: [
          { key: "anamnese", name: "Anamnèse", weight: 0.25, score: 80 },
          { key: "examen", name: "Examen", weight: 0.25, score: 70 },
          { key: "management", name: "Management", weight: 0.25, score: 60 },
          { key: "cloture", name: "Clôture", weight: 0.25, score: 50 },
          { key: "communication", name: "Communication", weight: 0, score: 0 },
        ],
        verdict: "Réussi",
      },
      stationType: "anamnese_examen" as StationType,
      communicationWeight: 0,
    };
    const fetchMock = vi.fn(fetchWithWeights((u) => {
      if (u.endsWith("/api/evaluator/evaluate")) return ok(classicResult);
      throw new Error(`Unexpected fetch to ${u}`);
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderClassic();

    await waitFor(() => expect(screen.getByTestId("score-anamnese")).toBeDefined());
    for (const axis of ["anamnese", "examen", "management", "cloture"] as const) {
      const row = screen.getByTestId(`score-${axis}`);
      expect(row.textContent).toContain("poids 25%");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Dette 7 — combinedGlobalScore (helper pondération 60/40 Q-A8)
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J4 — combinedGlobalScore (Q-A8 60/40)", () => {
  it("scoreP1=80, scoreP2=60 → 0.6×80 + 0.4×60 = 48 + 24 = 72", () => {
    expect(combinedGlobalScore(80, 60)).toBe(72);
  });

  it("scoreP1=100, scoreP2=0 → 60", () => {
    expect(combinedGlobalScore(100, 0)).toBe(60);
  });

  it("scoreP1=0, scoreP2=100 → 40", () => {
    expect(combinedGlobalScore(0, 100)).toBe(40);
  });

  it("Math.round cohérent : 0.6×73 + 0.4×54 = 43.8 + 21.6 = 65.4 → 65", () => {
    expect(combinedGlobalScore(73, 54)).toBe(65);
  });

  it("arrondi pair : 0.6×75 + 0.4×80 = 45 + 32 = 77 (entier exact)", () => {
    expect(combinedGlobalScore(75, 80)).toBe(77);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Dette 7 — rendu bilan combiné RESCOS-64-P2 (sessionStorage P1 OK)
// ────────────────────────────────────────────────────────────────────────

function buildPresentationResultRescos64P2(weightedScore: number): PresentationEvaluation {
  // Mock cohérent avec presentationEvaluator.ts : 4 axes à 25 % chacun,
  // normalized = score / max ∈ [0,1].
  const axisFactor = weightedScore / 100;
  return {
    stationId: "RESCOS-64-P2",
    parentStationId: "RESCOS-64",
    axes: {
      presentation: { axis: "presentation", items: [], score: 0, max: 0, normalized: axisFactor },
      raisonnement: { axis: "raisonnement", items: [], score: 0, max: 0, normalized: axisFactor },
      examens: { axis: "examens", items: [], score: 0, max: 0, normalized: axisFactor },
      management: { axis: "management", items: [], score: 0, max: 0, normalized: axisFactor },
    },
    weights: { presentation: 0.25, raisonnement: 0.25, examens: 0.25, management: 0.25 },
    weightedScore,
  };
}

function buildEvaluatorResultP1(globalScore: number): EvaluationResult {
  return {
    markdown: "# Rapport P1\n",
    scores: {
      globalScore,
      sections: [
        { key: "anamnese", name: "Anamnèse", weight: 0.225, score: globalScore },
        { key: "examen", name: "Examen", weight: 0.225, score: globalScore },
        { key: "management", name: "Management", weight: 0.225, score: globalScore },
        { key: "cloture", name: "Clôture", weight: 0.225, score: globalScore },
        { key: "communication", name: "Communication", weight: 0, score: 0 },
      ],
      verdict: "Réussi",
    },
    stationType: "anamnese_examen",
    communicationWeight: 0,
    medicoLegalScore: 75,
    medicoLegalWeight: 10,
  };
}

function renderP2(opts: {
  p1RecordError?: string;
  p1RecordPresent?: boolean;
  p1ScoreP1?: number;
  presentationScoreP2?: number;
  malformedSessionStorage?: boolean;
}) {
  const stationId = "RESCOS-64-P2";
  // Brief P2 simulé après Q-A10 : parentStationId présent.
  sessionStorage.setItem(
    `osce.session.${stationId}`,
    JSON.stringify({
      stationId,
      brief: {
        ...baseBriefFixture,
        stationId,
        parentStationId: "RESCOS-64",
      },
      transcript: [
        { role: "doctor", text: "Bonjour" },
        { role: "patient", text: "Bonjour docteur" },
      ],
    }),
  );
  // Conditionnellement : sessionStorage P1 (osce.eval.RESCOS-64).
  if (opts.malformedSessionStorage) {
    sessionStorage.setItem(part1EvalStorageKey("RESCOS-64"), "{not-json");
  } else if (opts.p1RecordPresent !== false) {
    const record = {
      stationId: "RESCOS-64",
      evaluatorResult: opts.p1RecordError ? null : buildEvaluatorResultP1(opts.p1ScoreP1 ?? 80),
      legalEvaluation: null,
      timestamp: 1234567890,
      error: opts.p1RecordError ?? null,
    };
    sessionStorage.setItem(part1EvalStorageKey("RESCOS-64"), JSON.stringify(record));
  }
  window.history.pushState({}, "", `/evaluation?station=${stationId}`);
  const { hook } = memoryLocation({ path: `/evaluation?station=${stationId}`, static: false });
  return render(
    <Router hook={hook}>
      <TooltipProvider>
        <Toaster />
        <Evaluation />
      </TooltipProvider>
    </Router>,
  );
}

function mockFetchPresentation(weightedScore: number) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.endsWith("/api/evaluator/weights")) return ok(PHASE2_WEIGHTS_PAYLOAD);
    if (u.endsWith("/api/evaluation/presentation")) {
      return ok(buildPresentationResultRescos64P2(weightedScore));
    }
    if (u.endsWith("/api/evaluation/legal")) {
      return bad(400, "bad_request", "Station ne déclare pas de legalContext.");
    }
    throw new Error(`Unexpected fetch to ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Phase 9 J4 — dette 7 : RESCOS-64-P2 avec sessionStorage P1 OK", () => {
  it("bandeau « Bilan combiné » présent + sections P1 et P2 rendues", async () => {
    mockFetchPresentation(60);
    renderP2({ p1RecordPresent: true, p1ScoreP1: 80 });

    await waitFor(() => expect(screen.getByTestId("combined-banner")).toBeDefined());
    expect(screen.getByTestId("combined-banner").textContent).toContain("Bilan combiné");
    expect(screen.getByTestId("combined-section-p1")).toBeDefined();
    expect(screen.getByTestId("combined-section-p2")).toBeDefined();
  });

  it("section P1 : 5 axes principaux + medico_legal rendus avec poids dynamiques (legalContext rééchelonné)", async () => {
    mockFetchPresentation(60);
    renderP2({ p1RecordPresent: true, p1ScoreP1: 80 });

    await waitFor(() => expect(screen.getByTestId("p1-score-anamnese")).toBeDefined());
    for (const axis of ["anamnese", "examen", "management", "cloture", "communication"] as const) {
      expect(screen.getByTestId(`p1-score-${axis}`)).toBeDefined();
    }
    // medico_legal fixture présent → 6e ligne
    expect(screen.getByTestId("p1-score-medico_legal")).toBeDefined();
    expect(screen.getByTestId("p1-score-anamnese").textContent).toContain("poids 23%");
    expect(screen.getByTestId("p1-score-medico_legal").textContent).toContain("(poids 10%)");
  });

  it("section P2 : 4 axes presentation/raisonnement/examens/management à 25 % chacun", async () => {
    mockFetchPresentation(60);
    renderP2({ p1RecordPresent: true, p1ScoreP1: 80 });

    await waitFor(() => expect(screen.getByTestId("p2-score-presentation")).toBeDefined());
    for (const axis of ["presentation", "raisonnement", "examens", "management"] as const) {
      const row = screen.getByTestId(`p2-score-${axis}`);
      expect(row.textContent).toContain("(poids 25%)");
    }
  });

  it("score global combiné = round(0.6 × scoreP1 + 0.4 × scoreP2) = round(0.6×80 + 0.4×60) = 72", async () => {
    mockFetchPresentation(60);
    renderP2({ p1RecordPresent: true, p1ScoreP1: 80 });

    await waitFor(() => expect(screen.getByTestId("combined-score-global")).toBeDefined());
    expect(screen.getByTestId("combined-score-global").textContent).toContain("72%");
    expect(screen.getByTestId("combined-score-p1").textContent).toContain("80%");
    expect(screen.getByTestId("combined-score-p2").textContent).toContain("60%");
  });

  it("/api/evaluation/presentation appelé une fois avec stationId=RESCOS-64-P2 + transcript sérialisé", async () => {
    const fetchMock = mockFetchPresentation(60);
    renderP2({ p1RecordPresent: true, p1ScoreP1: 80 });

    await waitFor(() => expect(screen.getByTestId("combined-section-p2")).toBeDefined());
    const presentationCalls = fetchMock.mock.calls.filter(([url]) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      return u.endsWith("/api/evaluation/presentation");
    });
    expect(presentationCalls.length).toBe(1);
    const [, init] = presentationCalls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.stationId).toBe("RESCOS-64-P2");
    expect(body.transcript).toContain("[doctor]");
  });
});

// ────────────────────────────────────────────────────────────────────────
// Dette 7 — fallback dégradé RESCOS-64-P2 (P1 absent / erreur / malformé)
// ────────────────────────────────────────────────────────────────────────

describe("Phase 9 J4 — dette 7 : fallback dégradé P1 absent/erreur/malformé", () => {
  it("sessionStorage P1 absent → bandeau d'avertissement, pas de score combiné, P2 seule", async () => {
    mockFetchPresentation(60);
    renderP2({ p1RecordPresent: false });

    await waitFor(() => expect(screen.getByTestId("combined-warning")).toBeDefined());
    expect(screen.getByTestId("combined-warning").textContent).toContain("Phase 1 indisponible");
    expect(screen.queryByTestId("combined-banner")).toBeNull();
    expect(screen.queryByTestId("combined-score-global")).toBeNull();
    expect(screen.queryByTestId("combined-section-p1")).toBeNull();
    expect(screen.getByTestId("combined-section-p2")).toBeDefined();
  });

  it("record P1 avec error défini → idem fallback (bandeau warning, pas de score combiné)", async () => {
    mockFetchPresentation(60);
    renderP2({ p1RecordPresent: true, p1RecordError: "evaluator: timeout" });

    await waitFor(() => expect(screen.getByTestId("combined-warning")).toBeDefined());
    expect(screen.queryByTestId("combined-banner")).toBeNull();
    expect(screen.queryByTestId("combined-score-global")).toBeNull();
    expect(screen.queryByTestId("combined-section-p1")).toBeNull();
    expect(screen.getByTestId("combined-section-p2")).toBeDefined();
  });

  it("sessionStorage P1 JSON malformé → fallback dégradé robuste (pas de crash)", async () => {
    mockFetchPresentation(60);
    renderP2({ malformedSessionStorage: true });

    await waitFor(() => expect(screen.getByTestId("combined-warning")).toBeDefined());
    expect(screen.queryByTestId("combined-banner")).toBeNull();
    expect(screen.queryByTestId("combined-score-global")).toBeNull();
    expect(screen.getByTestId("combined-section-p2")).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Dette 7 — non-régression stations classiques (parentStationId absent)
// ────────────────────────────────────────────────────────────────────────

function renderClassicWithFetch(
  stationId: string,
  result: EvaluationResult,
) {
  sessionStorage.setItem(
    `osce.session.${stationId}`,
    JSON.stringify({
      stationId,
      brief: { ...baseBriefFixture, stationId },
      transcript: [
        { role: "doctor", text: "Bonjour" },
        { role: "patient", text: "Bonjour docteur" },
      ],
    }),
  );
  window.history.pushState({}, "", `/evaluation?station=${stationId}`);
  const fetchMock = vi.fn(fetchWithWeights((u) => {
    if (u.endsWith("/api/evaluator/evaluate")) return ok(result);
    throw new Error(`Unexpected fetch to ${u}`);
  }));
  vi.stubGlobal("fetch", fetchMock);
  const { hook } = memoryLocation({ path: `/evaluation?station=${stationId}`, static: false });
  render(
    <Router hook={hook}>
      <TooltipProvider>
        <Toaster />
        <Evaluation />
      </TooltipProvider>
    </Router>,
  );
  return fetchMock;
}

describe("Phase 9 J4 — dette 7 : non-régression stations classiques (parentStationId absent)", () => {
  it("RESCOS-1 (anamnese_examen classique) : aucun bandeau combiné, comportement pré-J4", async () => {
    const fetchMock = renderClassicWithFetch(
      "RESCOS-1",
      {
        markdown: "# Rapport\n",
        scores: {
          globalScore: 72,
          sections: [
            { key: "anamnese", name: "Anamnèse", weight: 0.25, score: 80 },
            { key: "examen", name: "Examen", weight: 0.25, score: 70 },
            { key: "management", name: "Management", weight: 0.25, score: 60 },
            { key: "cloture", name: "Clôture", weight: 0.25, score: 50 },
            { key: "communication", name: "Communication", weight: 0, score: 0 },
          ],
          verdict: "Réussi",
        },
        stationType: "anamnese_examen",
        communicationWeight: 0,
      },
    );

    await waitFor(() => expect(screen.getByTestId("score-anamnese")).toBeDefined());
    expect(screen.queryByTestId("combined-banner")).toBeNull();
    expect(screen.queryByTestId("combined-warning")).toBeNull();
    expect(screen.queryByTestId("combined-section-p1")).toBeNull();
    expect(screen.queryByTestId("combined-section-p2")).toBeNull();
    expect(screen.getByTestId("score-global")).toBeDefined();
    // Aucun appel /api/evaluation/presentation pour station classique.
    const presentationCalls = fetchMock.mock.calls.filter(([url]) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      return u.endsWith("/api/evaluation/presentation");
    });
    expect(presentationCalls.length).toBe(0);
  });

  it("AMBOSS-24 (legalContext classique) : aucun bandeau combiné, 5 axes + medico_legal rendus", async () => {
    renderClassicWithFetch(
      "AMBOSS-24",
      {
        markdown: "# Rapport AMBOSS-24\n",
        scores: {
          globalScore: 70,
          sections: [
            { key: "anamnese", name: "Anamnèse", weight: 0.225, score: 80 },
            { key: "examen", name: "Examen", weight: 0.225, score: 70 },
            { key: "management", name: "Management", weight: 0.225, score: 60 },
            { key: "cloture", name: "Clôture", weight: 0.225, score: 50 },
            { key: "communication", name: "Communication", weight: 0, score: 0 },
          ],
          verdict: "Réussi",
        },
        stationType: "anamnese_examen",
        communicationWeight: 0,
        medicoLegalScore: 78,
        medicoLegalWeight: 10,
      },
    );

    await waitFor(() => expect(screen.getByTestId("score-anamnese")).toBeDefined());
    expect(screen.queryByTestId("combined-banner")).toBeNull();
    expect(screen.queryByTestId("combined-warning")).toBeNull();
    expect(screen.getByTestId("score-medico_legal")).toBeDefined();
    expect(screen.getByTestId("score-medico_legal").textContent).toContain("(poids 10%)");
  });
});
