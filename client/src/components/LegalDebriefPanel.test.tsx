// Phase 5 J4 — tests du panel de debrief médico-légal.
//
// Couvre :
//   • rendu conditionnel : station sans legalContext (400 du serveur)
//     → panel CACHÉ silencieusement (return null),
//   • bandeau résumé : badge catégorie + décision attendue + statut
//     mandatory_reporting,
//   • 4 axes avec scores 0/50/100 → 3 couleurs (vert ≥ 80, orange
//     50-79, rouge < 50),
//   • items must_verbalize avec icône check/dash/cross selon grade,
//   • items must_avoid avec préfixe « À éviter : » et icône warning
//     quand grade < 0,
//   • recommandations pédagogiques (missing + avoided) affichées
//     uniquement si non vides,
//   • a11y : aria-label sur les badges, aria-labelledby sur le panel.
//
// On mocke `fetch` pour contrôler la réponse de /api/evaluation/legal.
// Le projet n'a PAS @testing-library/jest-dom — on utilise les matchers
// vanilla vitest (toBeDefined / toBeNull / toBe / toMatch).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import LegalDebriefPanel from "./LegalDebriefPanel";
import type { LegalEvaluation } from "@/lib/api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ok(json: unknown): Response {
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function err400(message: string, code = "bad_request"): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

function err500(message: string): Response {
  return new Response(
    JSON.stringify({ error: message, code: "internal_error" }),
    { status: 500, headers: { "Content-Type": "application/json" } },
  );
}

const FIXTURE_AMBOSS24: LegalEvaluation = {
  stationId: "AMBOSS-24",
  category: "secret_pro_levee",
  expected_decision: "refer",
  mandatory_reporting: false,
  axes: {
    reconnaissance: {
      axis: "reconnaissance",
      score_pct: 100,
      items: [
        { text: "secret professionnel (art. 321 CP)", concept: "x", isAntiPattern: false, matchedPatterns: 2, grade: 2 },
        { text: "droit d'aviser vs devoir d'aviser", concept: "x", isAntiPattern: false, matchedPatterns: 2, grade: 2 },
      ],
    },
    verbalisation: {
      axis: "verbalisation",
      score_pct: 50,
      items: [
        { text: "confidentialité maintenue sauf danger imminent", concept: "x", isAntiPattern: false, matchedPatterns: 1, grade: 1 },
        { text: "promettre confidentialité absolue sans nuance", concept: "x", isAntiPattern: true, matchedPatterns: 0, grade: 0 },
      ],
    },
    decision: {
      axis: "decision",
      score_pct: 25,
      items: [
        { text: "ressources LAVI / centres d'aide aux victimes", concept: "x", isAntiPattern: false, matchedPatterns: 1, grade: 1 },
        { text: "certificat médical descriptif à fin de preuve", concept: "x", isAntiPattern: false, matchedPatterns: 0, grade: 0 },
      ],
    },
    communication: {
      axis: "communication",
      score_pct: 0,
      items: [
        { text: "respect de l'autonomie de la patiente", concept: "x", isAntiPattern: false, matchedPatterns: 0, grade: 0 },
        { text: "minimiser les faits ou les ecchymoses", concept: "x", isAntiPattern: true, matchedPatterns: 1, grade: -1 },
      ],
    },
  },
  missing: [
    "certificat médical descriptif à fin de preuve",
    "respect de l'autonomie de la patiente",
  ],
  avoided: ["minimiser les faits ou les ecchymoses"],
  unmapped: [],
  lexiconVersion: "1.0.0",
};

const FIXTURE_USMLE34_REPORT: LegalEvaluation = {
  ...FIXTURE_AMBOSS24,
  stationId: "USMLE-34",
  category: "signalement_maltraitance",
  expected_decision: "report",
  mandatory_reporting: true,
};

describe("LegalDebriefPanel — rendu conditionnel", () => {
  it("station SANS legalContext (400 bad_request) → panel CACHÉ silencieusement (rien rendu)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(err400("Station RESCOS-1 ne déclare pas de legalContext")),
    );
    const { container } = render(
      <LegalDebriefPanel stationId="RESCOS-1" transcript="Bonjour" />,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="legal-debrief-loading"]')).toBeNull();
    });
    expect(container.querySelector('[data-testid="legal-debrief-panel"]')).toBeNull();
    expect(container.querySelector('[data-testid="legal-debrief-error"]')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("réseau 500 → affiche le bandeau d'erreur (le panel ne se cache PAS)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(err500("Erreur upstream")));
    render(<LegalDebriefPanel stationId="X" transcript="Y" />);
    await waitFor(() => {
      expect(screen.getByTestId("legal-debrief-error")).toBeDefined();
    });
    expect(screen.getByText(/indisponible/i)).toBeDefined();
  });
});

describe("LegalDebriefPanel — rendu sur AMBOSS-24 (perfect-ish fixture)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(FIXTURE_AMBOSS24)));
  });

  it("affiche le bandeau résumé : catégorie, décision attendue, statut", async () => {
    render(<LegalDebriefPanel stationId="AMBOSS-24" transcript="…" />);
    await waitFor(() => {
      expect(screen.getByTestId("legal-debrief-panel")).toBeDefined();
    });
    expect(screen.getByTestId("legal-category-badge").textContent).toContain(
      "Levée du secret professionnel",
    );
    expect(screen.getByTestId("legal-decision-badge").textContent).toMatch(/Orienter/i);
    // mandatory_reporting=false → "Droit d'aviser"
    expect(screen.getByTestId("legal-reporting-badge").textContent).toMatch(/Droit d['’]aviser/i);
  });

  it("affiche les 4 axes avec leurs scores", async () => {
    render(<LegalDebriefPanel stationId="AMBOSS-24" transcript="…" />);
    await waitFor(() => {
      expect(screen.getByTestId("legal-debrief-panel")).toBeDefined();
    });
    expect(screen.getByTestId("legal-axis-reconnaissance").textContent).toContain("100%");
    expect(screen.getByTestId("legal-axis-verbalisation").textContent).toContain("50%");
    expect(screen.getByTestId("legal-axis-decision").textContent).toContain("25%");
    expect(screen.getByTestId("legal-axis-communication").textContent).toContain("0%");
  });

  it("affiche les 3 couleurs cohérentes avec les scores (≥80 vert, 50-79 orange, <50 rouge)", async () => {
    render(<LegalDebriefPanel stationId="AMBOSS-24" transcript="…" />);
    await waitFor(() => {
      expect(screen.getByTestId("legal-debrief-panel")).toBeDefined();
    });
    // reconnaissance 100 → vert (text-emerald-700)
    expect(
      screen.getByTestId("legal-axis-reconnaissance").querySelector(".text-emerald-700"),
    ).not.toBeNull();
    // verbalisation 50 → orange
    expect(
      screen.getByTestId("legal-axis-verbalisation").querySelector(".text-amber-700"),
    ).not.toBeNull();
    // decision 25 → rouge
    expect(
      screen.getByTestId("legal-axis-decision").querySelector(".text-red-700"),
    ).not.toBeNull();
    // communication 0 → rouge
    expect(
      screen.getByTestId("legal-axis-communication").querySelector(".text-red-700"),
    ).not.toBeNull();
  });

  it("préfixe « À éviter : » sur les anti-patterns must_avoid", async () => {
    render(<LegalDebriefPanel stationId="AMBOSS-24" transcript="…" />);
    await waitFor(() => {
      expect(screen.getByTestId("legal-debrief-panel")).toBeDefined();
    });
    // L'item « minimiser… » est anti-pattern et a été détecté (grade=-1).
    const communicationAxis = screen.getByTestId("legal-axis-communication");
    expect(communicationAxis.textContent).toMatch(/À éviter[\s\S]*minimiser/i);
  });

  it("recommandations pédagogiques : missing + avoided affichés quand non vides", async () => {
    render(<LegalDebriefPanel stationId="AMBOSS-24" transcript="…" />);
    await waitFor(() => {
      expect(screen.getByTestId("legal-debrief-panel")).toBeDefined();
    });
    const missing = screen.getByTestId("legal-missing");
    expect(missing.textContent).toContain(
      "certificat médical descriptif à fin de preuve",
    );
    expect(missing.textContent).toContain("respect de l'autonomie de la patiente");
    const avoided = screen.getByTestId("legal-avoided");
    expect(avoided.textContent).toContain("minimiser les faits ou les ecchymoses");
  });
});

describe("LegalDebriefPanel — rendu sur USMLE-34 (mandatory reporting)", () => {
  it("badge mandatory_reporting=true → « Devoir d'aviser » avec aria-label « obligatoire »", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(FIXTURE_USMLE34_REPORT)));
    render(<LegalDebriefPanel stationId="USMLE-34" transcript="…" />);
    await waitFor(() => {
      expect(screen.getByTestId("legal-debrief-panel")).toBeDefined();
    });
    const badge = screen.getByTestId("legal-reporting-badge");
    expect(badge.textContent).toMatch(/Devoir d['’]aviser/i);
    expect(badge.getAttribute("aria-label")).toContain("obligatoire");
  });

  it("décision « report » → libellé « Signaler à l'autorité » et tone rouge", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(FIXTURE_USMLE34_REPORT)));
    render(<LegalDebriefPanel stationId="USMLE-34" transcript="…" />);
    await waitFor(() => {
      expect(screen.getByTestId("legal-debrief-panel")).toBeDefined();
    });
    const badge = screen.getByTestId("legal-decision-badge");
    expect(badge.textContent).toMatch(/Signaler à l['’]autorité/i);
    expect(badge.className).toMatch(/bg-red-100/);
  });
});

describe("LegalDebriefPanel — recommandations pédagogiques (cas missing/avoided vides)", () => {
  it("missing+avoided vides → section recommandations N'EST PAS rendue", async () => {
    const PERFECT: LegalEvaluation = { ...FIXTURE_AMBOSS24, missing: [], avoided: [] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(PERFECT)));
    render(<LegalDebriefPanel stationId="AMBOSS-24" transcript="…" />);
    await waitFor(() => {
      expect(screen.getByTestId("legal-debrief-panel")).toBeDefined();
    });
    expect(screen.queryByTestId("legal-recommendations")).toBeNull();
    expect(screen.queryByTestId("legal-missing")).toBeNull();
    expect(screen.queryByTestId("legal-avoided")).toBeNull();
  });

  it("missing seul → recommendations affiche missing mais pas avoided", async () => {
    const ONLY_MISSING: LegalEvaluation = {
      ...FIXTURE_AMBOSS24,
      missing: ["item1"],
      avoided: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(ONLY_MISSING)));
    render(<LegalDebriefPanel stationId="AMBOSS-24" transcript="…" />);
    await waitFor(() => {
      expect(screen.getByTestId("legal-recommendations")).toBeDefined();
    });
    expect(screen.getByTestId("legal-missing")).toBeDefined();
    expect(screen.queryByTestId("legal-avoided")).toBeNull();
  });
});

describe("LegalDebriefPanel — a11y", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(FIXTURE_AMBOSS24)));
  });

  it("le panel est aria-labelledby pointant sur le titre", async () => {
    render(<LegalDebriefPanel stationId="AMBOSS-24" transcript="…" />);
    await waitFor(() => {
      expect(screen.getByTestId("legal-debrief-panel")).toBeDefined();
    });
    const panel = screen.getByTestId("legal-debrief-panel");
    expect(panel.getAttribute("aria-labelledby")).toBe("legal-debrief-title");
    const title = document.getElementById("legal-debrief-title");
    expect(title).not.toBeNull();
    expect(title!.textContent).toMatch(/Cadre médico-légal/i);
  });

  it("les badges critiques (décision, reporting) ont aria-label explicite", async () => {
    render(<LegalDebriefPanel stationId="AMBOSS-24" transcript="…" />);
    await waitFor(() => {
      expect(screen.getByTestId("legal-debrief-panel")).toBeDefined();
    });
    const decision = screen.getByTestId("legal-decision-badge");
    expect(decision.getAttribute("aria-label")).toContain("Décision attendue");
    const reporting = screen.getByTestId("legal-reporting-badge");
    expect(reporting.getAttribute("aria-label")).not.toBeNull();
    expect(reporting.getAttribute("aria-label")!.length).toBeGreaterThan(0);
  });
});
