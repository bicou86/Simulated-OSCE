import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  chatPatient,
  evaluate,
  getSettingsStatus,
  saveSettings,
  sttPatient,
  ttsPatient,
} from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ───────── saveSettings ─────────

  it("saveSettings POSTs JSON and returns the parsed result", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, persisted: true, openaiConfigured: true, anthropicConfigured: false }),
    );
    const result = await saveSettings({ openaiKey: "sk-test", persist: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/settings");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ openaiKey: "sk-test", persist: true });
    expect(result).toEqual({
      ok: true,
      persisted: true,
      openaiConfigured: true,
      anthropicConfigured: false,
    });
  });

  // ───────── getSettingsStatus ─────────

  it("getSettingsStatus GETs and returns the status payload", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ openai_ok: true, anthropic_ok: false, anthropic_reason: "unauthorized" }));
    const status = await getSettingsStatus();
    expect(fetchMock).toHaveBeenCalledWith("/api/settings/status", { method: "GET" });
    expect(status).toEqual({ openai_ok: true, anthropic_ok: false, anthropic_reason: "unauthorized" });
  });

  // ───────── Error envelope ─────────

  it("throws ApiError with code/hint/status when backend returns error envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Clé rejetée.", code: "unauthorized", hint: "Vérifiez la clé." }, 401),
    );
    await expect(getSettingsStatus()).rejects.toMatchObject({
      name: "ApiError",
      message: "Clé rejetée.",
      code: "unauthorized",
      hint: "Vérifiez la clé.",
      status: 401,
    });
  });

  it("throws ApiError with internal_error when response is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    await expect(getSettingsStatus()).rejects.toMatchObject({
      code: "internal_error",
      status: 500,
    });
  });

  it("throws ApiError with network_error when fetch itself rejects", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const err = await getSettingsStatus().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("network_error");
    expect((err as ApiError).status).toBe(0);
  });

  // ───────── chatPatient ─────────

  it("chatPatient sends station + history + userMessage", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reply: "Bonjour docteur." }));
    const result = await chatPatient({
      station: { scenario: "Douleur thoracique", context: "", vitals: { hr: "110" } },
      history: [{ role: "user", content: "Bonjour" }],
      userMessage: "Comment allez-vous ?",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/patient/chat");
    expect(JSON.parse(init.body as string).userMessage).toBe("Comment allez-vous ?");
    expect(result).toEqual({ reply: "Bonjour docteur." });
  });

  // ───────── sttPatient ─────────

  it("sttPatient sends multipart audio and parses the transcription", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ text: "bonjour" }));
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const result = await sttPatient(blob, "clip.webm");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/patient/stt");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    // Le champ "audio" est présent avec le bon type MIME ;
    // le nom de fichier est transmis par le runtime fetch natif (pas vérifiable dans happy-dom).
    const form = init.body as FormData;
    const audio = form.get("audio");
    expect(audio).not.toBeNull();
    expect((audio as Blob).type).toBe("audio/webm");
    expect((audio as Blob).size).toBe(3);
    expect(result).toEqual({ text: "bonjour" });
  });

  it("sttPatient maps backend error envelope to ApiError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Trop de requêtes", code: "rate_limited" }, 429),
    );
    const blob = new Blob([], { type: "audio/webm" });
    await expect(sttPatient(blob)).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });
  });

  // ───────── ttsPatient ─────────

  it("ttsPatient returns a Blob from the response", async () => {
    const audioBytes = new Uint8Array([0xff, 0xfb, 0x90, 0x64]);
    fetchMock.mockResolvedValueOnce(
      new Response(audioBytes, { status: 200, headers: { "Content-Type": "audio/mpeg" } }),
    );
    const blob = await ttsPatient("Bonjour.", "nova");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/patient/tts");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ text: "Bonjour.", voice: "nova" });
    expect(blob).toBeInstanceOf(Blob);
  });

  // ───────── evaluate ─────────

  it("evaluate POSTs to /api/evaluator/evaluate", async () => {
    const report = {
      globalScore: 82,
      anamnese: 85,
      examen: 75,
      communication: 90,
      diagnostic: 80,
      strengths: ["Bonne intro"],
      criticalOmissions: [],
      priorities: ["Structurer l'examen"],
      verdict: "Réussi" as const,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(report));
    const result = await evaluate({
      station: { scenario: "Test", title: "Douleur thoracique" },
      transcript: [
        { role: "doctor", text: "Bonjour" },
        { role: "patient", text: "Docteur j'ai mal" },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/evaluator/evaluate",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual(report);
  });

  it("evaluate surfaces upstream_error as ApiError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Non-JSON reply", code: "upstream_error", hint: "Retry" }, 502),
    );
    await expect(
      evaluate({
        station: { scenario: "x" },
        transcript: [{ role: "doctor", text: "hi" }],
      }),
    ).rejects.toMatchObject({ code: "upstream_error", status: 502, hint: "Retry" });
  });
});
