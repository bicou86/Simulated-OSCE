// Tests composant de la page Évaluation — vérifie le rendu Phase 2 :
//  - pill « Type : <label> » présente pour chaque station_type.
//  - 5 lignes d'axes avec les poids canoniques par type.
//  - ligne poids=0 grisée + tooltip "non évalué".
//
// On mocke window.fetch pour capturer l'appel /api/evaluator/evaluate et
// renvoyer un EvaluationResult contrôlé. sessionStorage alimente la
// `Session` lue par le composant.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import Evaluation, { buildDisplaySections } from "./Evaluation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import type { EvaluationResult, EvaluationWeightsResponse, StationType } from "@/lib/api";

// Évite de rendre le PDF pendant les tests — `@react-pdf/renderer` n'aime pas
// happy-dom et ça ralentit le test pour rien.
vi.mock("@/components/ReportPdf", () => ({
  ReportPdf: () => null,
}));

const briefFixture = {
  stationId: "",
  setting: "",
  patientDescription: "",
  vitals: {},
  phraseOuverture: "",
  sex: "female" as const,
  age: 47,
  interlocutor: { type: "self" as const, reason: "adult" },
};

// Construit un EvaluationResult minimal pour un station_type donné. Les
// scores par axe sont identiques entre types pour isoler l'effet des poids.
function buildResult(stationId: string, stationType: StationType): EvaluationResult {
  const weightsByType: Record<StationType, Record<string, number>> = {
    anamnese_examen:        { anamnese: 0.25, examen: 0.25, management: 0.25, cloture: 0.25, communication: 0 },
    bbn:                    { anamnese: 0.15, examen: 0.05, management: 0.15, cloture: 0.25, communication: 0.40 },
    psy:                    { anamnese: 0.25, examen: 0.05, management: 0.20, cloture: 0.20, communication: 0.30 },
    pediatrie_accompagnant: { anamnese: 0.25, examen: 0.20, management: 0.20, cloture: 0.15, communication: 0.20 },
    teleconsultation:       { anamnese: 0.35, examen: 0.05, management: 0.30, cloture: 0.15, communication: 0.15 },
    triage:                 { anamnese: 0.30, examen: 0.20, management: 0.35, cloture: 0.10, communication: 0.05 },
  };
  const w = weightsByType[stationType];
  return {
    markdown: "# Rapport\n\nContenu détaillé.",
    scores: {
      globalScore: 72,
      sections: [
        { key: "anamnese", name: "Anamnèse", weight: w.anamnese, score: 80 },
        { key: "examen", name: "Examen", weight: w.examen, score: 70 },
        { key: "management", name: "Management", weight: w.management, score: 60 },
        { key: "cloture", name: "Clôture", weight: w.cloture, score: 50 },
        { key: "communication", name: "Communication", weight: w.communication, score: 40 },
      ],
      verdict: "Réussi",
    },
    stationType,
    communicationWeight: Math.round(w.communication * 100),
  };
}

function ok(json: unknown): Response {
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  const stationId = "TEST-STATION";
  sessionStorage.setItem(
    `osce.session.${stationId}`,
    JSON.stringify({
      stationId,
      brief: { ...briefFixture, stationId },
      transcript: [
        { role: "doctor", text: "Bonjour" },
        { role: "patient", text: "Bonjour docteur" },
      ],
    }),
  );
  window.history.pushState({}, "", `/evaluation?station=${stationId}`);
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderEvaluation() {
  const { hook } = memoryLocation({ path: "/evaluation?station=TEST-STATION", static: false });
  return render(
    <Router hook={hook}>
      <TooltipProvider>
        <Toaster />
        <Evaluation />
      </TooltipProvider>
    </Router>,
  );
}

const STATION_TYPE_LABELS: Record<StationType, string> = {
  anamnese_examen: "Anamnèse-examen",
  bbn: "Annonce mauvaise nouvelle (BBN)",
  psy: "Entretien psychiatrique",
  pediatrie_accompagnant: "Pédiatrie avec accompagnant",
  teleconsultation: "Téléconsultation",
  triage: "Triage",
};

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

// Wrapper fetch : renvoie la table des poids pour /api/evaluator/weights et
// délègue au handler fourni pour le reste. Chaque test compose son handler
// pour /api/evaluator/evaluate + d'éventuels autres endpoints.
//
// Phase 5 J4 — par défaut, /api/evaluation/legal répond 400 (= station
// sans legalContext). Le panel se cache silencieusement (return null) et
// les tests existants ne voient AUCUNE différence visuelle. Les tests
// qui veulent tester le rendu du panel passent un handler custom qui
// répond 200 sur cette route.
function fetchWithWeights(
  handler: (url: string) => Response | Promise<Response>,
): (url: RequestInfo | URL) => Promise<Response> {
  return async (url: RequestInfo | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.endsWith("/api/evaluator/weights")) return ok(PHASE2_WEIGHTS_PAYLOAD);
    // Phase 5 J4 — /api/evaluation/legal : on laisse le handler du test
    // répondre EN PREMIER (les tests dédiés au panel renvoient 200 avec
    // une fixture). Si le handler ne connaît pas la route et throw, on
    // retombe sur le défaut 400 (= station sans legalContext, panel se
    // cache silencieusement). Cette indirection permet aux tests
    // existants de continuer à throw sur les URL inattendues sans avoir
    // à connaître /api/evaluation/legal explicitement.
    if (u.endsWith("/api/evaluation/legal")) {
      try {
        return await handler(u);
      } catch {
        return legalNotApplicableResponse();
      }
    }
    return handler(u);
  };
}

// Réponse 400 par défaut sur /api/evaluation/legal (= station sans
// legalContext, le panel se cache).
function legalNotApplicableResponse(): Response {
  return new Response(
    JSON.stringify({
      error: "Station ne déclare pas de legalContext.",
      code: "bad_request",
    }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}

describe("Evaluation — pill stationType (Bug A hotfix)", () => {
  for (const [type, label] of Object.entries(STATION_TYPE_LABELS) as Array<[StationType, string]>) {
    it(`${type} → pill rendue avec label "Type : ${label}"`, async () => {
      const fetchMock = vi.fn(fetchWithWeights((u) => {
        if (u.endsWith("/api/evaluator/evaluate")) {
          return ok(buildResult("TEST-STATION", type));
        }
        throw new Error(`Unexpected fetch to ${u}`);
      }));
      vi.stubGlobal("fetch", fetchMock);
      renderEvaluation();

      await waitFor(() => expect(screen.getByTestId("eval-station-type")).toBeDefined());
      const pill = screen.getByTestId("eval-station-type");
      expect(pill.textContent).toContain(`Type : ${label}`);
    });
  }
});

// Ce test reproduit le symptôme observé par le user en prod : serveur stale
// qui renvoie seulement 4 sections (sans Clôture). La fusion client-side
// doit synthétiser la rangée manquante via le fallback table v1.
//
// Phase 9 J4 — Bug 1 (Q-J4-1) : la priorité table-canonique vs existing.weight
// est INVERSÉE. existing.weight (backend dynamique, rééchelonné legalContext
// via getEffectiveAxisWeights) prime ; la table canonique ne sert plus que
// de fallback pour les axes ABSENTS de sections. Le scénario « Sonnet
// hallucine un poids ≠ canonique » n'est plus filtré par le front : le
// backend formate déjà les poids dynamiquement depuis Phase 7 J2.
describe("Evaluation — résilience à un serveur stale (axe Clôture absent)", () => {
  it("rend quand même 5 rangées : Clôture synthétisée via fallback canonique", async () => {
    const staleResult: EvaluationResult = {
      markdown: "# Rapport\n",
      scores: {
        globalScore: 55,
        sections: [
          // Stale server : ordre maintenu, Clôture absente. Poids Communication
          // à 0 (cohérent avec table v1 pour anamnese_examen) — Phase 9 J4
          // l'inversion buildDisplaySections rend ces poids tels quels.
          { key: "anamnese", name: "Anamnèse", weight: 0.25, score: 80 },
          { key: "examen", name: "Examen physique", weight: 0.25, score: 70 },
          { key: "management", name: "Management", weight: 0.25, score: 60 },
          { key: "communication", name: "Communication", weight: 0, score: 8 },
          // Pas de cloture !
        ],
        verdict: "À retravailler",
      },
      stationType: "anamnese_examen",
      communicationWeight: 0,
    };
    const fetchMock = vi.fn(fetchWithWeights((u) => {
      if (u.endsWith("/api/evaluator/evaluate")) return ok(staleResult);
      throw new Error(`Unexpected fetch to ${u}`);
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderEvaluation();

    await waitFor(() => expect(screen.getByTestId("score-cloture")).toBeDefined());

    // Les 5 axes sont là.
    for (const axis of ["anamnese", "examen", "management", "cloture", "communication"] as const) {
      expect(screen.getByTestId(`score-${axis}`)).toBeDefined();
    }
    // Clôture synthétisée : score 0, poids 25% (canonique anamnese_examen,
    // fallback Phase 9 J4 quand existing absent — comportement préservé).
    const cloture = screen.getByTestId("score-cloture");
    expect(cloture.textContent).toContain("Clôture");
    expect(cloture.textContent).toContain("poids 25%");
    // Communication présente côté backend avec weight=0 → 0% rendu (poids
    // dynamique respecté). Phase 9 J4 : la table canonique ne sert plus
    // d'override, mais ici les deux convergent (table v1 = 0 sur
    // anamnese_examen.communication).
    const comm = screen.getByTestId("score-communication");
    expect(comm.textContent).toContain("poids 0%");
    expect(comm.textContent).toContain("non évalué");
    expect(comm.className).toMatch(/opacity-60/);
  });
});

describe("Evaluation — 5 axes avec poids canoniques (Bug B hotfix)", () => {
  const expectedWeightsByType: Record<StationType, Record<string, number>> = {
    anamnese_examen:        { anamnese: 25, examen: 25, management: 25, cloture: 25, communication: 0 },
    bbn:                    { anamnese: 15, examen: 5, management: 15, cloture: 25, communication: 40 },
    psy:                    { anamnese: 25, examen: 5, management: 20, cloture: 20, communication: 30 },
    pediatrie_accompagnant: { anamnese: 25, examen: 20, management: 20, cloture: 15, communication: 20 },
    teleconsultation:       { anamnese: 35, examen: 5, management: 30, cloture: 15, communication: 15 },
    triage:                 { anamnese: 30, examen: 20, management: 35, cloture: 10, communication: 5 },
  };

  for (const [type, expected] of Object.entries(expectedWeightsByType) as Array<[StationType, Record<string, number>]>) {
    it(`${type} → 5 lignes d'axes avec poids exacts`, async () => {
      const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.endsWith("/api/evaluator/evaluate")) return ok(buildResult("TEST-STATION", type));
        throw new Error(`Unexpected fetch to ${u}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      renderEvaluation();

      await waitFor(() => expect(screen.getByTestId("score-anamnese")).toBeDefined());

      for (const axis of ["anamnese", "examen", "management", "cloture", "communication"] as const) {
        const row = screen.getByTestId(`score-${axis}`);
        expect(
          row.textContent,
          `${type} / ${axis}: weight string`,
        ).toContain(`poids ${expected[axis]}%`);
      }
    });
  }

  it("anamnese_examen → ligne Communication grisée + marqueur 'non évalué'", async () => {
    const fetchMock = vi.fn(fetchWithWeights((u) => {
      if (u.endsWith("/api/evaluator/evaluate")) {
        return ok(buildResult("TEST-STATION", "anamnese_examen"));
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderEvaluation();

    await waitFor(() => expect(screen.getByTestId("score-communication")).toBeDefined());
    const row = screen.getByTestId("score-communication");
    expect(row.className).toMatch(/opacity-60/);
    expect(row.textContent).toContain("non évalué");
  });

  it("anamnese_examen → la ligne Communication n'affiche JAMAIS 'poids 20%' (garde-fou bug B)", async () => {
    const fetchMock = vi.fn(fetchWithWeights((u) => {
      if (u.endsWith("/api/evaluator/evaluate")) {
        return ok(buildResult("TEST-STATION", "anamnese_examen"));
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderEvaluation();

    await waitFor(() => expect(screen.getByTestId("score-communication")).toBeDefined());
    const row = screen.getByTestId("score-communication");
    // Bug B observé en prod : Communication 20% sur anamnese_examen.
    // Ce garde-fou empêche toute régression silencieuse.
    expect(row.textContent).not.toContain("poids 20%");
    expect(row.textContent).toContain("poids 0%");
  });
});

// ─── Phase 5 J4 — intégration LegalDebriefPanel ───────────────────────────
//
// Vérifie le rendu CONDITIONNEL du panel sur la page Evaluation :
//   • station SANS legalContext (le défaut, /api/evaluation/legal renvoie
//     400 via fetchWithWeights) → panel ABSENT (invariants J4 #2 et #3).
//   • station AVEC legalContext (/api/evaluation/legal renvoie 200) →
//     panel rendu sous le rapport détaillé Phase 2/3.
//
// Le scoring 5-axes Phase 2/3 reste strictement intouché (mêmes
// assertions que les tests précédents), donc invariant J4 #1 verrouillé.

const LEGAL_FIXTURE_AMBOSS24 = {
  stationId: "TEST-STATION",
  category: "secret_pro_levee",
  expected_decision: "refer" as const,
  mandatory_reporting: false,
  axes: {
    reconnaissance: {
      axis: "reconnaissance" as const,
      score_pct: 100,
      items: [
        {
          text: "secret professionnel (art. 321 CP)",
          concept: "secret professionnel (art. 321 CP)",
          isAntiPattern: false,
          matchedPatterns: 2,
          grade: 2 as const,
        },
      ],
    },
    verbalisation: {
      axis: "verbalisation" as const,
      score_pct: 50,
      items: [],
    },
    decision: {
      axis: "decision" as const,
      score_pct: 75,
      items: [],
    },
    communication: {
      axis: "communication" as const,
      score_pct: 25,
      items: [],
    },
  },
  missing: ["item à verbaliser"],
  avoided: [],
  unmapped: [],
  lexiconVersion: "1.0.0",
};

describe("Evaluation — LegalDebriefPanel (Phase 5 J4)", () => {
  it("station SANS legalContext → panel ABSENT (invariant J4 #2)", async () => {
    const fetchMock = vi.fn(fetchWithWeights((u) => {
      if (u.endsWith("/api/evaluator/evaluate")) {
        return ok(buildResult("TEST-STATION", "anamnese_examen"));
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderEvaluation();

    // On attend le rendu Phase 2/3 (preuve que la page est arrivée au bout).
    await waitFor(() => expect(screen.getByTestId("score-anamnese")).toBeDefined());
    // Donne le temps au panel de tenter sa requête + se hider sur 400.
    await waitFor(() => {
      // Le panel ne doit PAS apparaître. On asserte explicitement après
      // que l'état loading transitoire ait disparu.
      expect(screen.queryByTestId("legal-debrief-loading")).toBeNull();
    });
    expect(screen.queryByTestId("legal-debrief-panel")).toBeNull();
    expect(screen.queryByTestId("legal-debrief-error")).toBeNull();
  });

  it("station AVEC legalContext → panel rendu, scoring 5-axes Phase 2/3 inchangé (invariant J4 #1)", async () => {
    const fetchMock = vi.fn(fetchWithWeights((u) => {
      if (u.endsWith("/api/evaluator/evaluate")) {
        return ok(buildResult("TEST-STATION", "anamnese_examen"));
      }
      // Override : cette station A un legalContext, on renvoie 200.
      // Note : on construit un fresh Response à chaque appel — Response.body
      // est single-use et le panel peut potentiellement remonter.
      if (u.endsWith("/api/evaluation/legal")) {
        return ok(LEGAL_FIXTURE_AMBOSS24);
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderEvaluation();

    // Le scoring 5-axes Phase 2/3 reste strictement présent.
    await waitFor(() => expect(screen.getByTestId("score-anamnese")).toBeDefined());
    for (const axis of ["anamnese", "examen", "management", "cloture", "communication"] as const) {
      expect(screen.getByTestId(`score-${axis}`)).toBeDefined();
    }
    // Le panel médico-légal apparaît en complément.
    await waitFor(() => expect(screen.getByTestId("legal-debrief-panel")).toBeDefined());
    // Et porte bien les valeurs canoniques du fixture.
    expect(screen.getByTestId("legal-category-badge").textContent).toContain(
      "Levée du secret professionnel",
    );
    expect(screen.getByTestId("legal-decision-badge").textContent).toMatch(/Orienter/i);
  });

  it("le panel s'affiche APRÈS le rapport détaillé (ordre vertical)", async () => {
    const fetchMock = vi.fn(fetchWithWeights((u) => {
      if (u.endsWith("/api/evaluator/evaluate")) {
        return ok(buildResult("TEST-STATION", "anamnese_examen"));
      }
      if (u.endsWith("/api/evaluation/legal")) {
        return ok(LEGAL_FIXTURE_AMBOSS24);
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderEvaluation();

    await waitFor(() => expect(screen.getByTestId("legal-debrief-panel")).toBeDefined());
    const reportCard = screen.getByText(/Rapport détaillé/i).closest("[class*='rounded-xl']");
    const panel = screen.getByTestId("legal-debrief-panel");
    expect(reportCard).not.toBeNull();
    // Position relative dans le DOM : le panel doit suivre le rapport.
    const ordering = reportCard!.compareDocumentPosition(panel);
    // Node.DOCUMENT_POSITION_FOLLOWING = 4 → panel est APRÈS reportCard.
    expect(ordering & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ─── Phase 7 J4 — 6e ligne axe medico_legal (conditionnelle) ────────────
//
// Vérifie que l'UI Evaluation expose la 6e rangée Médico-légal IFF la
// station a un legalContext (signal côté backend : medicoLegalScore +
// medicoLegalWeight définis dans EvaluationResult). Sans ces champs,
// rendu strictement identique à Phase 6 (5 axes uniquement).
//
// Garde-fou rétrocompat : 1 test sans medicoLegal* (≡ ~282 stations
// du corpus) → 5 axes seulement, aucun marker medico_legal dans le DOM.

function buildResultWithMedicoLegal(
  stationId: string,
  stationType: StationType,
  medicoLegalScore: number,
  medicoLegalWeight: number = 10,
): EvaluationResult {
  const base = buildResult(stationId, stationType);
  return {
    ...base,
    medicoLegalScore,
    medicoLegalWeight,
  };
}

describe("Evaluation — 6e ligne medico_legal conditionnelle (Phase 7 J4)", () => {
  it("station AVEC legalContext (medicoLegal* définis) → 6 axes affichés, ligne medico_legal présente", async () => {
    const fetchMock = vi.fn(fetchWithWeights((u) => {
      if (u.endsWith("/api/evaluator/evaluate")) {
        return ok(buildResultWithMedicoLegal("TEST-STATION", "anamnese_examen", 82, 10));
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderEvaluation();

    // Les 5 axes canoniques restent rendus.
    await waitFor(() => expect(screen.getByTestId("score-anamnese")).toBeDefined());
    for (const axis of ["anamnese", "examen", "management", "cloture", "communication"] as const) {
      expect(screen.getByTestId(`score-${axis}`)).toBeDefined();
    }
    // La 6e ligne medico_legal apparaît avec le bon score et le bon poids.
    const ml = screen.getByTestId("score-medico_legal");
    expect(ml.textContent).toContain("Médico-légal");
    expect(ml.textContent).toContain("(poids 10%)");
    expect(ml.textContent).toContain("82%");
  });

  it("station SANS legalContext (medicoLegal* undefined) → 5 axes seulement, ligne medico_legal ABSENTE (rétrocompat byte-à-byte Phase 6)", async () => {
    const fetchMock = vi.fn(fetchWithWeights((u) => {
      if (u.endsWith("/api/evaluator/evaluate")) {
        return ok(buildResult("TEST-STATION", "anamnese_examen"));
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderEvaluation();

    // 5 axes canoniques rendus, 6e absent.
    await waitFor(() => expect(screen.getByTestId("score-anamnese")).toBeDefined());
    for (const axis of ["anamnese", "examen", "management", "cloture", "communication"] as const) {
      expect(screen.getByTestId(`score-${axis}`)).toBeDefined();
    }
    expect(screen.queryByTestId("score-medico_legal")).toBeNull();
    // Garde-fou supplémentaire : aucun texte « Médico-légal » dans le
    // breakdown de la card Performance Globale (pour catcher une régression
    // qui rendrait la ligne sans data-testid).
    const perfCard = screen.getByText(/Performance Globale/i).closest("[class*='rounded-xl']");
    expect(perfCard).not.toBeNull();
    expect(perfCard!.textContent).not.toContain("Médico-légal");
  });

  it("station avec medicoLegalScore=0 et medicoLegalWeight=10 → ligne rendue (score=0 reste affichable)", async () => {
    // Cas limite : transcript vide médico-légalement → score 0 mais le
    // 6e axe doit toujours apparaître (= station avec legalContext mais
    // candidat n'a rien verbalisé), pas être hidden silencieusement.
    const fetchMock = vi.fn(fetchWithWeights((u) => {
      if (u.endsWith("/api/evaluator/evaluate")) {
        return ok(buildResultWithMedicoLegal("TEST-STATION", "anamnese_examen", 0, 10));
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderEvaluation();

    await waitFor(() => expect(screen.getByTestId("score-medico_legal")).toBeDefined());
    expect(screen.getByTestId("score-medico_legal").textContent).toContain("0%");
    expect(screen.getByTestId("score-medico_legal").textContent).toContain("(poids 10%)");
  });

  it("station avec medicoLegalScore défini mais medicoLegalWeight undefined → ligne ABSENTE (les deux champs requis)", async () => {
    // Garde défensive : si le backend produit un payload partiel (score
    // sans weight), l'UI ne rend pas la ligne (préfère silence à un poids
    // erroné). Cas peu probable post-J4 mais protège contre une régression
    // côté API future.
    const partial: EvaluationResult = {
      ...buildResult("TEST-STATION", "anamnese_examen"),
      medicoLegalScore: 75,
      // medicoLegalWeight intentionnellement undefined.
    };
    const fetchMock = vi.fn(fetchWithWeights((u) => {
      if (u.endsWith("/api/evaluator/evaluate")) {
        return ok(partial);
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderEvaluation();

    await waitFor(() => expect(screen.getByTestId("score-anamnese")).toBeDefined());
    expect(screen.queryByTestId("score-medico_legal")).toBeNull();
  });
});
