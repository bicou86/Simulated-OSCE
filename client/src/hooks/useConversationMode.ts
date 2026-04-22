// Mode conversation (VAD auto-silence) — écoute continue, détecte les tours de parole
// du candidat par RMS, émet l'audio capturé dès qu'un silence prolongé est détecté.
//
// Pipeline : getUserMedia → AudioContext + AnalyserNode (pour RMS) + MediaRecorder
// (pour capture blob). État interne piloté par une petite machine à états (idle →
// speaking → silence → idle). La machine est extraite en fonction pure pour pouvoir
// la tester sans dépendre de l'API Web Audio.
//
// Pendant que le patient parle (TTS) OU qu'une annonce système (speechSynthesis)
// est jouée, le hook doit être marqué `suspended: true` par le consommateur pour que
// la capture et la VAD soient ignorées (sinon la voix TTS serait captée et transcrite
// en boucle — effet larsen).

import { useCallback, useEffect, useRef, useState } from "react";

export interface ConversationModeOptions {
  silenceThresholdMs: number;
  minSpeechDurationMs: number;
  suspended: boolean;
  onUtteranceComplete: (clip: { blob: Blob; mimeType: string; filename: string }) => void;
  onError?: (err: Error) => void;
}

// Seuil RMS (0 → 1) au-dessus duquel on considère qu'il y a de la voix.
// Valeur choisie empiriquement : assez haute pour ignorer un bruit de ventilateur,
// assez basse pour capter une voix normale à ~40 cm d'un micro de laptop.
const RMS_VOICE_THRESHOLD = 0.015;

// ─────────── Machine à états (pure, testable) ───────────

export type VadState = "idle" | "speaking" | "silence";

export interface VadContext {
  state: VadState;
  // Timestamps (ms, monotone — performance.now()) collectés par l'appelant.
  speechStartedAt: number;
  lastVoiceAt: number;
  silenceStartedAt: number;
}

export type VadEvent =
  | { type: "none" }
  | { type: "speech_started" }
  | { type: "utterance_complete"; durationMs: number }
  | { type: "utterance_discarded"; reason: "too_short" };

export interface VadStepParams {
  now: number;
  isVoice: boolean;
  silenceThresholdMs: number;
  minSpeechDurationMs: number;
}

// Transition pure. Retourne le nouveau contexte + l'event à propager.
// Pas d'effets de bord — tout ce qui est I/O (enregistrement, MediaRecorder) est géré
// par le hook à partir de l'event retourné.
export function vadStep(ctx: VadContext, p: VadStepParams): { next: VadContext; event: VadEvent } {
  const { now, isVoice, silenceThresholdMs, minSpeechDurationMs } = p;

  if (ctx.state === "idle") {
    if (isVoice) {
      return {
        next: { state: "speaking", speechStartedAt: now, lastVoiceAt: now, silenceStartedAt: 0 },
        event: { type: "speech_started" },
      };
    }
    return { next: ctx, event: { type: "none" } };
  }

  if (ctx.state === "speaking") {
    if (isVoice) {
      return {
        next: { ...ctx, lastVoiceAt: now },
        event: { type: "none" },
      };
    }
    return {
      next: { ...ctx, state: "silence", silenceStartedAt: now },
      event: { type: "none" },
    };
  }

  // silence
  if (isVoice) {
    return {
      next: { ...ctx, state: "speaking", lastVoiceAt: now },
      event: { type: "none" },
    };
  }
  const silenceMs = now - ctx.silenceStartedAt;
  if (silenceMs < silenceThresholdMs) {
    return { next: ctx, event: { type: "none" } };
  }
  // Silence confirmé → fin de tour de parole.
  const utteranceMs = ctx.lastVoiceAt - ctx.speechStartedAt;
  const event: VadEvent =
    utteranceMs >= minSpeechDurationMs
      ? { type: "utterance_complete", durationMs: utteranceMs }
      : { type: "utterance_discarded", reason: "too_short" };
  return {
    next: { state: "idle", speechStartedAt: 0, lastVoiceAt: 0, silenceStartedAt: 0 },
    event,
  };
}

// Utilitaire RMS — extrait pour pouvoir le tester sans AnalyserNode.
export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  return Math.sqrt(sumSq / samples.length);
}

// ─────────── Hook ───────────

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

function extensionForMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  return "bin";
}

export interface UseConversationModeResult {
  isActive: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  start: () => Promise<void>;
  stop: () => void;
}

export function useConversationMode(options: ConversationModeOptions): UseConversationModeResult {
  const [isActive, setIsActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const optsRef = useRef(options);
  useEffect(() => { optsRef.current = options; }, [options]);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordingMimeRef = useRef<string>("");
  const rafRef = useRef<number | null>(null);

  const vadCtxRef = useRef<VadContext>({
    state: "idle",
    speechStartedAt: 0,
    lastVoiceAt: 0,
    silenceStartedAt: 0,
  });

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try { recorderRef.current?.stop(); } catch { /* noop */ }
    recorderRef.current = null;
    chunksRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try { void contextRef.current?.close(); } catch { /* noop */ }
    contextRef.current = null;
    analyserRef.current = null;
    vadCtxRef.current = { state: "idle", speechStartedAt: 0, lastVoiceAt: 0, silenceStartedAt: 0 };
    setIsListening(false);
    setIsSpeaking(false);
  }, []);

  const startRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    const mime = pickMimeType();
    recordingMimeRef.current = mime;
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    });
    recorderRef.current = recorder;
    recorder.start();
  }, []);

  // Stoppe le recorder en cours et, selon l'event, émet un blob ou le jette.
  const flushRecorder = useCallback((emit: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const mime = recordingMimeRef.current || recorder.mimeType || "audio/webm";
    const onStop = () => {
      if (emit && chunksRef.current.length > 0) {
        const blob = new Blob(chunksRef.current, { type: mime });
        const filename = `utterance.${extensionForMime(mime)}`;
        try { optsRef.current.onUtteranceComplete({ blob, mimeType: mime, filename }); } catch { /* noop */ }
      }
      chunksRef.current = [];
    };
    recorder.addEventListener("stop", onStop, { once: true });
    try { recorder.stop(); } catch { /* noop */ }
    recorderRef.current = null;
  }, []);

  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    const rms = computeRms(samples);
    const suspended = optsRef.current.suspended;
    const isVoice = !suspended && rms > RMS_VOICE_THRESHOLD;
    setIsSpeaking(isVoice);

    const now = performance.now();
    const { next, event } = vadStep(vadCtxRef.current, {
      now,
      isVoice,
      silenceThresholdMs: optsRef.current.silenceThresholdMs,
      minSpeechDurationMs: optsRef.current.minSpeechDurationMs,
    });
    vadCtxRef.current = next;

    if (event.type === "speech_started") {
      startRecorder();
    } else if (event.type === "utterance_complete") {
      flushRecorder(true);
    } else if (event.type === "utterance_discarded") {
      flushRecorder(false);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [flushRecorder, startRecorder]);

  const start = useCallback(async () => {
    if (isActive) return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Mode conversation non supporté par ce navigateur.");
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtx: typeof AudioContext =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
      const ctx = new AudioCtx();
      contextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      setIsActive(true);
      setIsListening(true);
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      cleanup();
      optsRef.current.onError?.(err as Error);
      throw err;
    }
  }, [cleanup, isActive, tick]);

  const stop = useCallback(() => {
    setIsActive(false);
    cleanup();
  }, [cleanup]);

  // Cleanup au démontage.
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return { isActive, isListening, isSpeaking, start, stop };
}
