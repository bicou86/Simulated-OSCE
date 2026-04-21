import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  chatPatient,
  evaluate,
  getPatientBrief,
  getSettingsStatus,
  listStations,
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
  afterEach(() => vi.unstubAllGlobals());

  // ───── Settings ─────

  it("saveSettings POSTs JSON payload", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, persisted: true, openaiConfigured: true, anthropicConfigured: false }));
    const result = await saveSettings({ openaiKey: "sk-test", persist: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/settings");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ openaiKey: "sk-test", persist: true });
    expect(result.persisted).toBe(true);
  });

  it("getSettingsStatus returns the status payload", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ openai_ok: true, anthropic_ok: true }));
    const status = await getSettingsStatus();
    expect(fetchMock).toHaveBeenCalledWith("/api/settings/status", { method: "GET" });
    expect(status.openai_ok).toBe(true);
  });

  // ───── Error envelope ─────

  it("throws ApiError with code/hint/status on backend error envelope", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Clé rejetée.", code: "unauthorized", hint: "Vérifiez la clé." }, 401));
    await expect(getSettingsStatus()).rejects.toMatchObject({
      name: "ApiError", code: "unauthorized", status: 401, hint: "Vérifiez la clé.",
    });
  });

  it("throws ApiError with network_error when fetch rejects", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const err = await getSettingsStatus().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("network_error");
  });

  // ───── Stations ─────

  it("listStations GETs /api/stations", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      stations: [{ id: "RESCOS-1", title: "X", source: "RESCOS", setting: "Cabinet" }],
      total: 1,
    }));
    const res = await listStations();
    expect(fetchMock).toHaveBeenCalledWith("/api/stations", { method: "GET" });
    expect(res.total).toBe(1);
    expect(res.stations[0].id).toBe("RESCOS-1");
  });

  // ───── Patient ─────

  it("getPatientBrief fetches the feuille de porte", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      stationId: "RESCOS-1", setting: "Cabinet", patientDescription: "Patient",
      vitals: { ta: "120/80" }, phraseOuverture: "Bonjour",
    }));
    const brief = await getPatientBrief("RESCOS-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/patient/RESCOS-1/brief", { method: "GET" });
    expect(brief.vitals.ta).toBe("120/80");
  });

  it("chatPatient sends stationId + mode", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reply: "Bonjour docteur." }));
    const res = await chatPatient({
      stationId: "RESCOS-1",
      history: [{ role: "user", content: "Bonjour" }],
      userMessage: "Comment allez-vous ?",
      mode: "voice",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/patient/chat");
    const body = JSON.parse(init.body as string);
    expect(body.stationId).toBe("RESCOS-1");
    expect(body.mode).toBe("voice");
    expect(res.reply).toBe("Bonjour docteur.");
  });

  it("sttPatient sends multipart audio and parses the transcription", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ text: "bonjour" }));
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const result = await sttPatient(blob, "clip.webm");
    const [, init] = fetchMock.mock.calls[0];
    const form = init.body as FormData;
    expect((form.get("audio") as Blob).type).toBe("audio/webm");
    expect(result.text).toBe("bonjour");
  });

  it("ttsPatient returns a Blob", async () => {
    const audioBytes = new Uint8Array([0xff, 0xfb, 0x90, 0x64]);
    fetchMock.mockResolvedValueOnce(new Response(audioBytes, {
      status: 200, headers: { "Content-Type": "audio/mpeg" },
    }));
    const blob = await ttsPatient("Bonjour.", "nova");
    expect(blob).toBeInstanceOf(Blob);
  });

  // ───── Evaluator ─────

  it("evaluate returns { markdown, scores }", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      markdown: "# Rapport\n\nDétails",
      scores: {
        globalScore: 72,
        sections: [{ key: "anamnese", name: "Anamnèse", weight: 0.3, score: 80, raw: "8/10" }],
        verdict: "Réussi",
      },
    }));
    const result = await evaluate({
      stationId: "RESCOS-1",
      transcript: [{ role: "doctor", text: "hi" }, { role: "patient", text: "bonjour" }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/evaluator/evaluate",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.markdown).toContain("Rapport");
    expect(result.scores.verdict).toBe("Réussi");
  });
});
