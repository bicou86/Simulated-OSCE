// Test d'intégration du routeur d'intention dans Simulation : vérifie qu'un
// geste d'examen déclenche le POST /api/examiner/lookup et rend la bulle
// Findings — Examinateur, et qu'une requête verbale continue de passer par
// l'endpoint patient (non testé ici mais le mock neutralise sendStream).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import Simulation from "./Simulation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";

// Pas de vrai MediaRecorder sous happy-dom.
vi.mock("@/hooks/useMediaRecorder", () => ({
  useMediaRecorder: () => ({
    isRecording: false,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

// On veut éviter tout appel SSE réel : le test porte uniquement sur le chemin
// examinateur. sendMessage n'est pas appelé dans ce chemin car le router
// détecte "je palpe..." comme geste.
vi.mock("@/hooks/useStreamingChat", () => ({
  useStreamingChat: () => ({
    sendMessage: vi.fn(async () => ({ fullText: "", aborted: false })),
    abort: vi.fn(),
    isStreaming: false,
    partialText: "",
    isAudioPlaying: false,
  }),
}));

// Le mode conversation n'est pas testé ici — on retourne des valeurs inertes.
vi.mock("@/hooks/useConversationMode", () => ({
  useConversationMode: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    state: "off" as const,
    level: 0,
  }),
}));

beforeEach(() => {
  // jsdom/happy-dom window.location is not writable by default via assignment;
  // wouter memory-location lets us bypass that.
  window.history.pushState({}, "", "/simulation?station=TEST-1");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderSimulation() {
  const { hook } = memoryLocation({ path: "/simulation?station=TEST-1", static: false });
  return render(
    <Router hook={hook}>
      <TooltipProvider>
        <Toaster />
        <Simulation />
      </TooltipProvider>
    </Router>,
  );
}

const briefFixture = {
  stationId: "TEST-1",
  setting: "Cabinet",
  patientDescription: "Patient test, 47 ans.",
  vitals: { ta: "120/80" },
  phraseOuverture: "Bonjour docteur.",
  sex: "female",
  age: 47,
  interlocutor: { type: "self", reason: "adult competent" },
};

function ok(json: unknown): Response {
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Simulation — routage d'intention examiner", () => {
  it("rend la bulle Findings — Examinateur quand le candidat verbalise un geste", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/patient/TEST-1/brief")) return ok(briefFixture);
      if (u.endsWith("/api/examiner/lookup")) {
        return ok({
          match: true,
          kind: "finding",
          stationId: "TEST-1",
          query: "je palpe l'abdomen",
          categoryKey: "e5",
          categoryName: "Examen abdominal",
          maneuver: "Palpation de l'abdomen",
          resultat: "Douleur à l'épigastre et à l'hypocondre droit",
        });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSimulation();

    // Attendre le chargement du brief (l'écran "Chargement de la station…" disparaît).
    await waitFor(() => expect(screen.getByTestId("button-start")).toBeDefined());

    // Démarrer la station pour activer les inputs.
    fireEvent.click(screen.getByTestId("button-start"));

    const input = await screen.findByTestId("input-text") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "je palpe l'abdomen" } });

    const sendButton = screen.getByTestId("button-send-text");
    fireEvent.click(sendButton);

    // La bulle examiner doit apparaître avec le bon texte.
    await waitFor(() => {
      expect(screen.getByTestId("bubble-examiner")).toBeDefined();
    });
    const bubble = screen.getByTestId("bubble-examiner");
    expect(bubble.textContent).toMatch(/Findings — Examinateur/);
    expect(bubble.textContent).toMatch(/Palpation de l'abdomen/);
    expect(bubble.textContent).toMatch(/épigastre/i);

    // Vérifier que POST /api/examiner/lookup a bien été appelé.
    const calls = fetchMock.mock.calls.map((c) => (typeof c[0] === "string" ? c[0] : String(c[0])));
    expect(calls.some((u) => u.includes("/api/examiner/lookup"))).toBe(true);
  });

  it("affiche une bulle d'erreur rouge si l'examinateur ne répond pas (abort réseau)", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/patient/TEST-1/brief")) return ok(briefFixture);
      if (u.endsWith("/api/examiner/lookup")) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted.");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // Fake timers pour fast-forward le setTimeout de 10 s → instantané.
    // `shouldAdvanceTime: true` laisse les micro-tâches (await fetch, setState)
    // avancer naturellement ; on contrôle juste les setTimeout.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderSimulation();
      await waitFor(() => expect(screen.getByTestId("button-start")).toBeDefined());
      fireEvent.click(screen.getByTestId("button-start"));

      const input = await screen.findByTestId("input-text") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "je palpe l'abdomen" } });
      fireEvent.click(screen.getByTestId("button-send-text"));

      // Laisse la micro-tâche (fetch démarré) s'enchaîner, puis avance le temps
      // pour déclencher le abort.
      await Promise.resolve();
      vi.advanceTimersByTime(11_000);

      await waitFor(() => {
        expect(screen.getByTestId("bubble-examiner-error")).toBeDefined();
      });
      const bubble = screen.getByTestId("bubble-examiner-error");
      expect(bubble.textContent).toMatch(/Erreur examinateur/);
      expect(bubble.textContent).toMatch(/Temps de réponse dépassé/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("affiche un fallback visible quand l'examinateur ne trouve aucun finding", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/patient/TEST-1/brief")) return ok(briefFixture);
      if (u.endsWith("/api/examiner/lookup")) {
        return ok({
          match: false,
          kind: "no_match",
          stationId: "TEST-1",
          query: "je fais qqchose de bizarre",
          fallback: "Finding non disponible pour cette station — passez à l'examen suivant ou consultez l'examinateur.",
        });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSimulation();
    await waitFor(() => expect(screen.getByTestId("button-start")).toBeDefined());
    fireEvent.click(screen.getByTestId("button-start"));

    const input = await screen.findByTestId("input-text") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "je palpe qqchose bizarre" } });
    fireEvent.click(screen.getByTestId("button-send-text"));

    await waitFor(() => {
      expect(screen.getByTestId("bubble-examiner")).toBeDefined();
    });
    const bubble = screen.getByTestId("bubble-examiner");
    expect(bubble.textContent).toMatch(/Finding non disponible/i);
  });

  it("affiche le message téléconsultation dédié (Bug #3)", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/patient/TEST-1/brief")) return ok(briefFixture);
      if (u.endsWith("/api/examiner/lookup")) {
        return ok({
          match: false,
          kind: "no_teleconsult",
          stationId: "TEST-1",
          query: "je palpe l'abdomen",
          fallback: "Examen physique impossible en téléconsultation. Reformulez en question au parent/patient ou demandez une consultation en présentiel.",
        });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSimulation();
    await waitFor(() => expect(screen.getByTestId("button-start")).toBeDefined());
    fireEvent.click(screen.getByTestId("button-start"));

    const input = await screen.findByTestId("input-text") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "je palpe l'abdomen" } });
    fireEvent.click(screen.getByTestId("button-send-text"));

    await waitFor(() => expect(screen.getByTestId("bubble-examiner")).toBeDefined());
    const bubble = screen.getByTestId("bubble-examiner");
    expect(bubble.textContent).toMatch(/téléconsultation/i);
    expect(bubble.textContent).toMatch(/parent|présentiel/i);
  });

  it("rend une bulle unique avec liste à puces pour kind=findings (Bug #2)", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/patient/TEST-1/brief")) return ok(briefFixture);
      if (u.endsWith("/api/examiner/lookup")) {
        return ok({
          match: true,
          kind: "findings",
          stationId: "TEST-1",
          query: "otoscopie, Rinne et Weber",
          items: [
            { categoryKey: "e3", categoryName: "Otoscopie", maneuver: "Otoscopie bilatérale", resultat: "Normale des deux côtés" },
            { categoryKey: "e4", categoryName: "Diapason", maneuver: "Test de Rinne bilatéral", resultat: "normal - conduction aérienne > osseuse" },
            { categoryKey: "e4", categoryName: "Diapason", maneuver: "Test de Weber", resultat: "normal - pas de latéralisation" },
          ],
        });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSimulation();
    await waitFor(() => expect(screen.getByTestId("button-start")).toBeDefined());
    fireEvent.click(screen.getByTestId("button-start"));

    const input = await screen.findByTestId("input-text") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "otoscopie, puis Rinne et Weber" } });
    fireEvent.click(screen.getByTestId("button-send-text"));

    await waitFor(() => expect(screen.getByTestId("bubble-examiner")).toBeDefined());
    // Une seule bulle examinateur avec 3 items dedans (liste <ul><li>…).
    const bubbles = screen.getAllByTestId("bubble-examiner");
    expect(bubbles.length).toBe(1);
    const bubble = bubbles[0];
    expect(bubble.textContent).toMatch(/Otoscopie bilatérale/);
    expect(bubble.textContent).toMatch(/Test de Rinne/);
    expect(bubble.textContent).toMatch(/Test de Weber/);
    // Les 3 findings doivent cohabiter dans des <li>.
    expect(bubble.querySelectorAll("li").length).toBe(3);
  });
});
