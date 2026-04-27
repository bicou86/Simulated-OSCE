// Hook de streaming SSE pour /api/patient/chat/stream.
//
// Particularités :
// - Utilise fetch + ReadableStream (EventSource est GET-only, inutilisable ici).
// - Parse manuellement le flux text/event-stream.
// - Pour chaque event "sentence", déclenche un TTS et enqueue le blob dans une file audio
//   jouée séquentiellement (le clip N+1 attend la fin de N via l'event "ended").
// - AbortController permet de stopper le stream + vider la file audio.
// - Fallback : si la requête échoue avant le premier delta, le consommateur peut
//   rappeler l'endpoint non-streaming /chat classique.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  ttsPatient,
  type ChatInput,
  type ChatReplyClarification,
  type ParticipantRoleClient,
  type TtsVoice,
} from "@/lib/api";

export interface StreamingChatOptions {
  voice: TtsVoice;
  onSentence?: (text: string, index: number) => void;
  onError?: (err: ApiError) => void;
  // Phase 4 J2 — déclenché dès l'event SSE `speaker` (avant tout delta).
  // Permet à l'UI de mettre à jour le label du tour en cours sans attendre
  // la fin de la réponse.
  onSpeaker?: (speaker: { speakerId: string; speakerRole: ParticipantRoleClient }) => void;
  // Phase 4 J2 — le routeur n'a pas pu trancher : l'UI doit afficher un
  // panneau « À qui parlez-vous ? ». Aucun audio n'est joué dans ce cas.
  onClarification?: (payload: Omit<ChatReplyClarification, "type">) => void;
}

export interface StreamResult {
  fullText: string;
  aborted: boolean;
  // Phase 4 J2 — id/rôle du participant qui a réellement répondu sur ce
  // tour. `null` si le tour s'est terminé en clarification (pas de réponse
  // LLM produite).
  speakerId: string | null;
  speakerRole: ParticipantRoleClient | null;
  // Phase 4 J2 — le serveur a renvoyé un payload de clarification.
  clarification?: Omit<ChatReplyClarification, "type">;
}

interface SseEvent {
  event: string;
  data: string;
}

// Parse incrémental : découpe `buffer` (terminé par \n\n) en events SSE discrets.
function parseSse(buffer: string): SseEvent[] {
  const events: SseEvent[] = [];
  let cursor = 0;
  while (true) {
    const delimiter = buffer.indexOf("\n\n", cursor);
    if (delimiter === -1) return events;
    const block = buffer.slice(cursor, delimiter);
    cursor = delimiter + 2;
    let eventName = "message";
    const dataParts: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataParts.push(line.slice(5).trimStart());
    }
    events.push({ event: eventName, data: dataParts.join("\n") });
  }
}

export function useStreamingChat(options: StreamingChatOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [partialText, setPartialText] = useState("");
  // isAudioPlaying = au moins un clip TTS est en cours OU la file en contient un.
  // Exposé pour que les consommateurs (ex. mode conversation / VAD) puissent se
  // suspendre pendant que le patient parle, afin d'éviter un larsen.
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const urlsToRevoke = useRef<string[]>([]);

  const playNext = useCallback(() => {
    const el = audioElementRef.current;
    if (!el) return;
    const next = audioQueueRef.current.shift();
    if (!next) {
      playingRef.current = false;
      setIsAudioPlaying(false);
      return;
    }
    playingRef.current = true;
    setIsAudioPlaying(true);
    el.src = next;
    el.play().catch(() => {
      // Autoplay bloqué ou clip corrompu → on passe au suivant pour ne pas figer la file.
      playingRef.current = false;
      playNext();
    });
  }, []);

  // Élément <audio> caché, créé au premier montage pour jouer les clips en séquence.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = new Audio();
    el.preload = "auto";
    audioElementRef.current = el;
    const onEnded = () => playNext();
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("ended", onEnded);
      el.pause();
      urlsToRevoke.current.forEach((u) => URL.revokeObjectURL(u));
      urlsToRevoke.current = [];
    };
  }, [playNext]);

  const enqueueAudio = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urlsToRevoke.current.push(url);
    audioQueueRef.current.push(url);
    if (!playingRef.current) playNext();
  }, [playNext]);

  const stopAudio = useCallback(() => {
    const el = audioElementRef.current;
    if (el) {
      el.pause();
      el.src = "";
    }
    audioQueueRef.current = [];
    playingRef.current = false;
    setIsAudioPlaying(false);
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    stopAudio();
    setIsStreaming(false);
  }, [stopAudio]);

  const sendMessage = useCallback(async (input: ChatInput): Promise<StreamResult> => {
    abort(); // annule tout stream précédent encore en cours
    setPartialText("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const voice = options.voice;

    try {
      const res = await fetch("/api/patient/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError({
          message: body.error ?? `HTTP ${res.status}`,
          code: body.code ?? "internal_error",
          hint: body.hint,
          status: res.status,
        });
      }

      // Garde-fou : si la route SSE n'est pas montée (ex. interception par le fallback
      // SPA Vite), le serveur renvoie 200 OK + text/html. Ça passerait le parseur sans
      // produire un seul event, et le consommateur verrait un fullText vide sans erreur.
      // On force une ApiError ici pour que le consommateur bascule sur le fallback.
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("text/event-stream")) {
        throw new ApiError({
          message: "Réponse SSE invalide",
          code: "invalid_sse_response",
          hint: `Content-Type reçu : ${contentType || "absent"}`,
          status: res.status,
        });
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let speakerId: string | null = null;
      let speakerRole: ParticipantRoleClient | null = null;
      let clarification: Omit<ChatReplyClarification, "type"> | undefined;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse events accumulés jusqu'au dernier délimiteur ; garde le reste dans le buffer.
        const lastDelim = buffer.lastIndexOf("\n\n");
        if (lastDelim === -1) continue;
        const ready = buffer.slice(0, lastDelim + 2);
        buffer = buffer.slice(lastDelim + 2);

        for (const evt of parseSse(ready)) {
          let payload: any = {};
          try { payload = JSON.parse(evt.data); } catch { /* ignore */ }

          if (evt.event === "delta") {
            setPartialText((prev) => prev + (payload.text ?? ""));
          } else if (evt.event === "sentence") {
            const text: string = payload.text ?? "";
            const index: number = payload.index ?? 0;
            options.onSentence?.(text, index);
            // Lance le TTS en parallèle du stream — la file audio gère la séquence.
            ttsPatient(text, voice)
              .then(enqueueAudio)
              .catch(() => { /* une phrase sans audio, on continue silencieusement */ });
          } else if (evt.event === "done") {
            fullText = payload.fullText ?? "";
          } else if (evt.event === "speaker") {
            // Phase 4 J2 — premier event d'un tour résolu : on tag le speaker
            // courant pour que l'UI affiche le bon label (« Mère du patient »
            // vs « Patient ») avant le premier delta.
            speakerId = payload.speakerId ?? null;
            speakerRole = (payload.speakerRole ?? null) as ParticipantRoleClient | null;
            if (speakerId && speakerRole) {
              options.onSpeaker?.({ speakerId, speakerRole });
            }
          } else if (evt.event === "clarification_needed") {
            // Phase 4 J2 — le routeur a tranché « ambigu ». On ne reçoit
            // aucun delta/done — on remonte le payload au consommateur via
            // onClarification + le champ `clarification` de StreamResult.
            clarification = {
              reason: payload.reason ?? "",
              candidates: payload.candidates ?? [],
            };
            options.onClarification?.(clarification);
          } else if (evt.event === "error") {
            const err = new ApiError({
              message: payload.message ?? "Streaming interrompu",
              code: payload.code ?? "internal_error",
              hint: payload.hint,
              status: 0,
            });
            options.onError?.(err);
            throw err;
          }
        }
      }

      return { fullText, aborted: false, speakerId, speakerRole, clarification };
    } catch (err) {
      if ((err as any)?.name === "AbortError") {
        return { fullText: "", aborted: true, speakerId: null, speakerRole: null };
      }
      throw err;
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  }, [abort, enqueueAudio, options]);

  return {
    isStreaming,
    partialText,
    isAudioPlaying,
    sendMessage,
    abort,
  };
}
