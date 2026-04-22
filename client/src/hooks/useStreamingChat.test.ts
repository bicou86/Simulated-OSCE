// Tests du garde Content-Type dans useStreamingChat : quand la route SSE n'est pas
// montée côté serveur (fallback SPA qui renvoie HTML en 200), le hook doit lever
// une ApiError "invalid_sse_response" pour que le consommateur bascule sur le
// fallback non-stream.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useStreamingChat } from "./useStreamingChat";
import { ApiError } from "@/lib/api";

// ttsPatient est appelé par le hook sur chaque event "sentence" — on le stub pour
// éviter toute dépendance à une MediaSource réelle sous happy-dom.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    ttsPatient: vi.fn(async () => new Blob([], { type: "audio/mpeg" })),
  };
});

function htmlResponse(): Response {
  return new Response("<!DOCTYPE html><html><body>Vite SPA</body></html>", {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

const INPUT = {
  stationId: "RESCOS-1",
  history: [] as Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: "Bonjour",
  mode: "text" as const,
};

describe("useStreamingChat — Content-Type guard", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("throws invalid_sse_response when server returns text/html", async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse());

    const { result } = renderHook(() => useStreamingChat({ voice: "nova" }));

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.sendMessage(INPUT);
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("invalid_sse_response");
    expect((caught as ApiError).status).toBe(200);
  });

  it("passes through when Content-Type is text/event-stream", async () => {
    // Un SSE minimal avec un done pour laisser le hook terminer proprement.
    const body = [
      "event: delta",
      "data: {\"text\":\"Hi\"}",
      "",
      "event: done",
      "data: {\"fullText\":\"Hi\"}",
      "",
      "",
    ].join("\n");
    fetchMock.mockResolvedValueOnce(sseResponse(body));

    const { result } = renderHook(() => useStreamingChat({ voice: "nova" }));

    let out: { fullText: string; aborted: boolean } | undefined;
    await act(async () => {
      out = await result.current.sendMessage(INPUT);
    });

    expect(out?.aborted).toBe(false);
    expect(out?.fullText).toBe("Hi");
  });
});
