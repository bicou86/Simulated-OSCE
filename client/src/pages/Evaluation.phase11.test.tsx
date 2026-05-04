// Phase 11 J4 — tests d'intégration page Evaluation × fetch /pedagogy.
//
// Vérifie le branchement client-side du nouveau fetch parallèle :
//   1. Le fetch /api/patient/:id/pedagogy est déclenché au montage
//   2. Le `pedagogicalContent` est propagé à <ReportPdf> quand présent
//   3. Échec de fetch (rejet réseau / 500) → null transmis (fallback A26)
//   4. Pendant le pending, l'UI rendue ne crashe pas (rendu legacy intact)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// Mock le composant <ReportPdf> pour intercepter ses props (notamment
// `pedagogicalContent`) sans déclencher le rendu @react-pdf/renderer.
const reportPdfPropsCalls: Array<Record<string, unknown>> = [];
vi.mock("@/components/ReportPdf", () => ({
  ReportPdf: (props: Record<string, unknown>) => {
    reportPdfPropsCalls.push(props);
    return null;
  },
}));

import Evaluation from "./Evaluation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import type { EvaluationResult, EvaluationWeightsResponse, StationType } from "@/lib/api";

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

function buildResult(stationId: string, stationType: StationType): EvaluationResult {
  return {
    markdown: "# Rapport\n",
    scores: {
      globalScore: 70,
      sections: [
        { key: "anamnese", name: "Anamnèse", weight: 0.25, score: 70 },
        { key: "examen", name: "Examen", weight: 0.25, score: 70 },
        { key: "management", name: "Management", weight: 0.25, score: 70 },
        { key: "cloture", name: "Clôture", weight: 0.25, score: 70 },
        { key: "communication", name: "Communication", weight: 0, score: 0 },
      ],
      verdict: "Réussi",
    },
    stationType,
    communicationWeight: 0,
  };
}

const PHASE2_WEIGHTS: EvaluationWeightsResponse = {
  axes: ["anamnese", "examen", "management", "cloture", "communication"],
  weights: {
    anamnese_examen: { anamnese: 25, examen: 25, management: 25, cloture: 25, communication: 0 },
    bbn: { anamnese: 15, examen: 5, management: 15, cloture: 25, communication: 40 },
    psy: { anamnese: 25, examen: 5, management: 20, cloture: 20, communication: 30 },
    pediatrie_accompagnant: { anamnese: 25, examen: 20, management: 20, cloture: 15, communication: 20 },
    teleconsultation: { anamnese: 35, examen: 5, management: 30, cloture: 15, communication: 15 },
    triage: { anamnese: 30, examen: 20, management: 35, cloture: 10, communication: 5 },
  },
};

const STATION_ID = "PEDAGOGY-TEST";

beforeEach(() => {
  reportPdfPropsCalls.length = 0;
  sessionStorage.setItem(
    `osce.session.${STATION_ID}`,
    JSON.stringify({
      stationId: STATION_ID,
      brief: { ...briefFixture, stationId: STATION_ID },
      transcript: [
        { role: "doctor", text: "Bonjour" },
        { role: "patient", text: "Bonjour docteur" },
      ],
    }),
  );
  window.history.pushState({}, "", `/evaluation?station=${STATION_ID}`);
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderEvaluation() {
  const { hook } = memoryLocation({ path: `/evaluation?station=${STATION_ID}`, static: false });
  return render(
    <Router hook={hook}>
      <TooltipProvider>
        <Toaster />
        <Evaluation />
      </TooltipProvider>
    </Router>,
  );
}

function ok(json: unknown): Response {
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Phase 11 J4 — Evaluation × fetch /pedagogy", () => {
  it("appelle /api/patient/:id/pedagogy au montage (fetch parallèle)", async () => {
    const fetchCalls: string[] = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      fetchCalls.push(u);
      if (u.endsWith("/api/evaluator/weights")) return ok(PHASE2_WEIGHTS);
      if (u.endsWith("/api/evaluator/evaluate")) return ok(buildResult(STATION_ID, "anamnese_examen"));
      if (u.includes("/pedagogy")) return ok({ stationId: STATION_ID, pedagogicalContent: null });
      if (u.endsWith("/api/evaluation/legal")) return new Response("{}", { status: 400 });
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderEvaluation();
    await waitFor(() => {
      expect(fetchCalls.some((u) => u.includes(`/api/patient/${STATION_ID}/pedagogy`))).toBe(true);
    });
  });

  it("propage pedagogicalContent non-null à <ReportPdf>", async () => {
    const pedagogicalContent = {
      resume: { titre: "Résumé test", sections: [{ titre: "Section 1" }] },
    };
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/evaluator/weights")) return ok(PHASE2_WEIGHTS);
      if (u.endsWith("/api/evaluator/evaluate")) return ok(buildResult(STATION_ID, "anamnese_examen"));
      if (u.includes("/pedagogy")) return ok({ stationId: STATION_ID, pedagogicalContent });
      if (u.endsWith("/api/evaluation/legal")) return new Response("{}", { status: 400 });
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderEvaluation();
    // Attend que le bouton "Exporter en PDF" soit rendu (signe que le composant est complet)
    await waitFor(() => expect(screen.getByTestId("button-export-pdf")).toBeDefined());
    // Déclenche l'export pour propager pedagogicalContent à <ReportPdf>
    const button = screen.getByTestId("button-export-pdf") as HTMLButtonElement;
    button.click();
    await waitFor(() => {
      const last = reportPdfPropsCalls[reportPdfPropsCalls.length - 1];
      expect(last).toBeDefined();
      expect(last.pedagogicalContent).toEqual(pedagogicalContent);
    });
  });

  it("échec fetch /pedagogy → pedagogicalContent={null} propagé à <ReportPdf>", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/evaluator/weights")) return ok(PHASE2_WEIGHTS);
      if (u.endsWith("/api/evaluator/evaluate")) return ok(buildResult(STATION_ID, "anamnese_examen"));
      if (u.includes("/pedagogy"))
        return new Response(JSON.stringify({ error: "boom", code: "internal_error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      if (u.endsWith("/api/evaluation/legal")) return new Response("{}", { status: 400 });
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderEvaluation();
    await waitFor(() => expect(screen.getByTestId("button-export-pdf")).toBeDefined());
    const button = screen.getByTestId("button-export-pdf") as HTMLButtonElement;
    button.click();
    await waitFor(() => {
      const last = reportPdfPropsCalls[reportPdfPropsCalls.length - 1];
      expect(last).toBeDefined();
      // En cas d'erreur fetch, le state reste à null (initial) → propagé tel quel.
      expect(last.pedagogicalContent).toBeNull();
    });
  });

  it("fetch /pedagogy pending → composant Evaluation rendu sans crash (rendu legacy intact)", async () => {
    let resolvePedagogy: ((res: Response) => void) | undefined;
    const pedagogyPromise = new Promise<Response>((resolve) => {
      resolvePedagogy = resolve;
    });
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/evaluator/weights")) return ok(PHASE2_WEIGHTS);
      if (u.endsWith("/api/evaluator/evaluate")) return ok(buildResult(STATION_ID, "anamnese_examen"));
      if (u.includes("/pedagogy")) return pedagogyPromise;
      if (u.endsWith("/api/evaluation/legal")) return new Response("{}", { status: 400 });
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderEvaluation();
    // L'UI principale doit être rendue (boutons, scores) même si /pedagogy
    // n'a pas répondu. Aucun crash, aucun blocage.
    await waitFor(() => expect(screen.getByTestId("button-export-pdf")).toBeDefined());
    expect(screen.getByTestId("score-anamnese")).toBeDefined();
    // Cleanup : on résout pour ne pas laisser une promise orpheline.
    resolvePedagogy?.(ok({ stationId: STATION_ID, pedagogicalContent: null }));
  });
});
