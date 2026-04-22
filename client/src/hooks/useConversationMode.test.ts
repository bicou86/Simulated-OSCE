// Tests de la machine à états VAD (pure, extraite du hook) + computeRms.
// Les tests du pipeline complet (getUserMedia → MediaRecorder) ne sont pas faits ici
// car happy-dom n'implémente pas AudioContext/MediaRecorder de façon fonctionnelle ;
// on valide plutôt la logique déterministe de la machine avec des scénarios RMS
// discrets.

import { describe, expect, it } from "vitest";
import { computeRms, vadStep, type VadContext } from "./useConversationMode";

const IDLE: VadContext = { state: "idle", speechStartedAt: 0, lastVoiceAt: 0, silenceStartedAt: 0 };

describe("computeRms", () => {
  it("returns 0 on empty buffer", () => {
    expect(computeRms(new Float32Array(0))).toBe(0);
  });

  it("returns 0 on zero samples (pure silence)", () => {
    expect(computeRms(new Float32Array([0, 0, 0, 0, 0, 0]))).toBe(0);
  });

  it("returns the amplitude on a constant tone", () => {
    const samples = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    expect(computeRms(samples)).toBeCloseTo(0.5, 5);
  });

  it("is sign-agnostic (squared sum)", () => {
    const a = computeRms(new Float32Array([0.3, -0.3, 0.3, -0.3]));
    const b = computeRms(new Float32Array([0.3, 0.3, 0.3, 0.3]));
    expect(a).toBeCloseTo(b, 5);
  });
});

describe("vadStep state machine", () => {
  const BASE = { silenceThresholdMs: 1500, minSpeechDurationMs: 400 };

  it("stays idle on continuous silence", () => {
    const r = vadStep(IDLE, { ...BASE, now: 100, isVoice: false });
    expect(r.next.state).toBe("idle");
    expect(r.event.type).toBe("none");
  });

  it("idle → speaking on first voice, emits speech_started", () => {
    const r = vadStep(IDLE, { ...BASE, now: 100, isVoice: true });
    expect(r.next.state).toBe("speaking");
    expect(r.next.speechStartedAt).toBe(100);
    expect(r.next.lastVoiceAt).toBe(100);
    expect(r.event.type).toBe("speech_started");
  });

  it("tracks lastVoiceAt while speaking", () => {
    const step1 = vadStep(IDLE, { ...BASE, now: 100, isVoice: true });
    const step2 = vadStep(step1.next, { ...BASE, now: 300, isVoice: true });
    const step3 = vadStep(step2.next, { ...BASE, now: 500, isVoice: true });
    expect(step3.next.state).toBe("speaking");
    expect(step3.next.lastVoiceAt).toBe(500);
    expect(step3.event.type).toBe("none");
  });

  it("speaking → silence on voice drop, records silenceStartedAt", () => {
    const step1 = vadStep(IDLE, { ...BASE, now: 100, isVoice: true });
    const step2 = vadStep(step1.next, { ...BASE, now: 500, isVoice: false });
    expect(step2.next.state).toBe("silence");
    expect(step2.next.silenceStartedAt).toBe(500);
    expect(step2.next.lastVoiceAt).toBe(100); // reste au dernier "vraiment" voix
    expect(step2.event.type).toBe("none");
  });

  it("silence → speaking when voice resumes before threshold", () => {
    const step1 = vadStep(IDLE, { ...BASE, now: 100, isVoice: true });
    const step2 = vadStep(step1.next, { ...BASE, now: 500, isVoice: false });
    const step3 = vadStep(step2.next, { ...BASE, now: 900, isVoice: true });
    expect(step3.next.state).toBe("speaking");
    expect(step3.next.lastVoiceAt).toBe(900);
  });

  it("silence threshold reached → utterance_complete when utterance long enough", () => {
    // Parle de 100 → 800 (700 ms ≥ 400 min), silence à partir de 800.
    // Threshold 1500 ms atteint à 2300.
    let ctx = IDLE;
    let r = vadStep(ctx, { ...BASE, now: 100, isVoice: true });
    ctx = r.next;
    r = vadStep(ctx, { ...BASE, now: 800, isVoice: true });
    ctx = r.next;
    r = vadStep(ctx, { ...BASE, now: 900, isVoice: false }); // entre en silence
    ctx = r.next;
    expect(ctx.state).toBe("silence");
    // Encore dans le threshold, aucun event :
    r = vadStep(ctx, { ...BASE, now: 2000, isVoice: false });
    expect(r.event.type).toBe("none");
    ctx = r.next;
    // Dépassement du threshold :
    r = vadStep(ctx, { ...BASE, now: 2500, isVoice: false });
    expect(r.event.type).toBe("utterance_complete");
    if (r.event.type === "utterance_complete") {
      expect(r.event.durationMs).toBe(800 - 100); // 700 ms
    }
    expect(r.next.state).toBe("idle");
  });

  it("silence threshold reached → utterance_discarded when below minSpeechDurationMs", () => {
    // Parle 100 → 250 (150 ms < 400 min).
    let ctx = IDLE;
    let r = vadStep(ctx, { ...BASE, now: 100, isVoice: true });
    ctx = r.next;
    r = vadStep(ctx, { ...BASE, now: 250, isVoice: true });
    ctx = r.next;
    r = vadStep(ctx, { ...BASE, now: 260, isVoice: false });
    ctx = r.next;
    r = vadStep(ctx, { ...BASE, now: 2000, isVoice: false });
    expect(r.event.type).toBe("utterance_discarded");
    if (r.event.type === "utterance_discarded") {
      expect(r.event.reason).toBe("too_short");
    }
    expect(r.next.state).toBe("idle");
  });

  it("ignores voice when suspended=true is enforced by caller (isVoice=false)", () => {
    // Le hook passe isVoice=false quand suspended. Ici on simule cela :
    // voix arrive mais isVoice reste false → on reste idle, pas d'utterance.
    const r = vadStep(IDLE, { ...BASE, now: 100, isVoice: false });
    expect(r.next.state).toBe("idle");
    expect(r.event.type).toBe("none");
  });
});
