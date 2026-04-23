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
function fetchWithWeights(
  handler: (url: string) => Response | Promise<Response>,
): (url: RequestInfo | URL) => Promise<Response> {
  return async (url: RequestInfo | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.endsWith("/api/evaluator/weights")) return ok(PHASE2_WEIGHTS_PAYLOAD);
    return handler(u);
  };
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

// Ce test reproduit EXACTEMENT le symptôme observé par le user en prod après
// le 1er hotfix (3c5359f) : serveur stale qui renvoie seulement 4 sections
// (sans Clôture) avec un weight Communication à 0.25. La fusion client-side
// doit quand même rendre les 5 rangées avec les poids Phase 2 canoniques,
// pas ceux que Sonnet a hallucinés.
describe("Evaluation — résilience à un serveur stale (4 sections, weights Sonnet-hallucinés)", () => {
  it("rend quand même 5 rangées avec les poids canoniques Phase 2", async () => {
    const staleResult: EvaluationResult = {
      markdown: "# Rapport\n",
      scores: {
        globalScore: 55,
        sections: [
          // Stale server : ordre et weight Sonnet-hallucinés, Clôture absente.
          { key: "anamnese", name: "Anamnèse", weight: 0.25, score: 80 },
          { key: "examen", name: "Examen physique", weight: 0.25, score: 70 },
          { key: "management", name: "Management", weight: 0.25, score: 60 },
          { key: "communication", name: "Communication", weight: 0.25, score: 8 },
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
    // Clôture synthétisée : score 0, poids 25% (canonique anamnese_examen).
    const cloture = screen.getByTestId("score-cloture");
    expect(cloture.textContent).toContain("Clôture");
    expect(cloture.textContent).toContain("poids 25%");
    // Communication reprend son poids CANONIQUE (0), pas celui que Sonnet
    // a halluciné (0.25). C'est la bulle garde-fou du bug observé en prod.
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
