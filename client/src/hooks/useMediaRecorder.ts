// Hook d'enregistrement micro push-to-talk.
// - Détecte le meilleur mime supporté (webm/opus, sinon mp4 pour Safari).
// - stop() renvoie une Promise résolvant avec le Blob final + filename cohérent.

import { useCallback, useRef, useState } from "react";

export interface RecordedClip {
  blob: Blob;
  mimeType: string;
  filename: string;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/ogg;codecs=opus",
  ];
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

export function useMediaRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeRef = useRef<string>("");
  const stopPromiseRef = useRef<{
    resolve: (clip: RecordedClip) => void;
    reject: (err: Error) => void;
  } | null>(null);

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const start = useCallback(async (): Promise<void> => {
    setError(null);
    if (isRecording) return;

    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const msg = "Micro non supporté par ce navigateur.";
      setError(msg);
      throw new Error(msg);
    }

    const mime = pickMimeType();
    mimeRef.current = mime;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const msg = (err as Error).message || "Accès au micro refusé.";
      setError(msg);
      throw new Error(msg);
    }
    streamRef.current = stream;

    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    });

    recorder.addEventListener("stop", () => {
      const finalMime = mimeRef.current || recorder.mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: finalMime });
      cleanup();
      setIsRecording(false);
      const pending = stopPromiseRef.current;
      stopPromiseRef.current = null;
      if (pending) {
        pending.resolve({
          blob,
          mimeType: finalMime,
          filename: `audio.${extensionForMime(finalMime)}`,
        });
      }
    });

    recorder.addEventListener("error", (event) => {
      const err = (event as unknown as { error?: Error }).error ?? new Error("Enregistrement interrompu.");
      setError(err.message);
      cleanup();
      setIsRecording(false);
      const pending = stopPromiseRef.current;
      stopPromiseRef.current = null;
      pending?.reject(err);
    });

    recorder.start();
    setIsRecording(true);
  }, [cleanup, isRecording]);

  const stop = useCallback((): Promise<RecordedClip> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return Promise.reject(new Error("Aucun enregistrement en cours."));
    }
    return new Promise<RecordedClip>((resolve, reject) => {
      stopPromiseRef.current = { resolve, reject };
      try {
        recorder.stop();
      } catch (err) {
        stopPromiseRef.current = null;
        reject(err as Error);
      }
    });
  }, []);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    cleanup();
    setIsRecording(false);
    const pending = stopPromiseRef.current;
    stopPromiseRef.current = null;
    pending?.reject(new Error("Enregistrement annulé."));
  }, [cleanup]);

  return { isRecording, error, start, stop, cancel };
}
