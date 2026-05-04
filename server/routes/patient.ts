// Routes HTTP "patient" — la logique vit dans patientService.
//   POST /api/patient/chat  — conversation (GPT-4o-mini / gpt-4o)
//   POST /api/patient/stt   — transcription Whisper
//   POST /api/patient/tts   — synthèse vocale OpenAI (emojis nettoyés)
//   GET  /api/patient/:id/opening — phrase d'ouverture (pour TTS à Démarrer)

import { Router, type Request, type Response } from "express";
import OpenAI, { toFile } from "openai";
import multer from "multer";
import { z } from "zod";

import { getOpenAIKey } from "../lib/config";
import { mapUpstreamError, sendApiError, sendUpstreamError } from "../lib/errors";
import { logRequest } from "../lib/logger";
import { sanitizeForTts } from "../lib/textSanitize";
import {
  getPatientBrief,
  runPatientChat,
  StationNotFoundError,
  streamPatientChat,
} from "../services/patientService";
import { getPatientPedagogy } from "../services/pedagogyService";

const router = Router();

// ───────── Chat ─────────

const ChatBody = z
  .object({
    stationId: z.string().min(1),
    history: z
      .array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }))
      .default([]),
    // Phase 9 J1 — relâche min(1) au profit d'un superRefine conditionnel :
    // userMessage doit rester non-vide SAUF en mode examinateur à T0
    // (history vide), où le LLM ouvre la conversation sans message
    // candidat préalable. Tous les autres cas conservent le contrat
    // historique (zéro régression sur les 287 stations patient simulé).
    userMessage: z.string(),
    mode: z.enum(["voice", "text"]).default("voice"),
    model: z.enum(["gpt-4o-mini", "gpt-4o"]).optional(),
    // Phase 4 J2 — id du participant qui a parlé au tour précédent (sticky).
    // Optionnel : à T0 le client n'en a pas, le serveur retombera sur le défaut
    // de la station (cf. PatientBrief.defaultSpeakerId).
    currentSpeakerId: z.string().min(1).nullable().optional(),
    // Phase 9 J1 — discriminant flow conversationnel.
    //   • "patient" (défaut, rétrocompat 287 stations) : flow patient
    //     simulé classique, candidat parle en premier, routing
    //     multi-profils via addressRouter.
    //   • "examiner" (station double partie 2 uniquement, shortId -P2) :
    //     flow examinateur OSCE, LLM ouvre la conversation, pose les 15
    //     questions ordonnées, neutre, pas d'aide ; bypass routing.
    conversationMode: z.enum(["patient", "examiner"]).default("patient"),
  })
  .superRefine((data, ctx) => {
    // userMessage doit être non-vide SAUF en mode examiner à T0 (history vide).
    const isExaminerOpen =
      data.conversationMode === "examiner" && data.history.length === 0;
    if (!isExaminerOpen && data.userMessage.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: 1,
        type: "string",
        inclusive: true,
        path: ["userMessage"],
        message: "userMessage requis (sauf mode examiner à T0).",
      });
    }
  });

router.post("/chat", async (req: Request, res: Response) => {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    return sendApiError(res, "bad_request", "Payload /chat invalide.", parsed.error.issues[0]?.message);
  }
  if (!getOpenAIKey()) {
    return sendApiError(res, "not_configured", "Clé OpenAI manquante.");
  }
  try {
    const outcome = await runPatientChat(parsed.data);
    if (outcome.type === "clarification_needed") {
      // Pas d'appel LLM effectué — on retourne un payload spécial qui pilote
      // l'UI de clarification (« À qui parlez-vous ? » avec boutons profils).
      return res.json(outcome);
    }
    // Rétrocompat : on garde `reply` au top-level (clients pré-J2) et on
    // ajoute speakerId/speakerRole + le discriminant `type` pour les nouveaux.
    return res.json({
      type: "reply",
      reply: outcome.reply,
      speakerId: outcome.speakerId,
      speakerRole: outcome.speakerRole,
    });
  } catch (err) {
    if (err instanceof StationNotFoundError) {
      return sendApiError(res, "bad_request", err.message);
    }
    if ((err as Error).message === "OPENAI_API_KEY_MISSING") {
      return sendApiError(res, "not_configured", "Clé OpenAI manquante.");
    }
    return sendUpstreamError(res, err);
  }
});

// ───────── Chat streaming (SSE) ─────────
//
// POST /api/patient/chat/stream — envoie des events text/event-stream :
//   event: delta    data: { text }
//   event: sentence data: { text, index }   (dès qu'une phrase complète est prête)
//   event: done     data: { fullText }
//   event: error    data: { code, message } (sur échec upstream, puis fin du stream)
//
// Le client combine les `delta` pour afficher en "machine à écrire" et lance le TTS
// de chaque `sentence` en parallèle pour jouer l'audio progressivement.

function writeSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

router.post("/chat/stream", async (req: Request, res: Response) => {
  // eslint-disable-next-line no-console
  console.log(`[sse] /api/patient/chat/stream hit — stationId=${req.body?.stationId ?? "?"}`);
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    return sendApiError(res, "bad_request", "Payload /chat/stream invalide.", parsed.error.issues[0]?.message);
  }
  if (!getOpenAIKey()) {
    return sendApiError(res, "not_configured", "Clé OpenAI manquante.");
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // AbortController propagé jusqu'au SDK OpenAI : dès que le socket de réponse se
  // ferme prématurément (client qui annule, proxy qui coupe), on abort l'appel upstream
  // pour ne pas facturer de tokens inutiles. On s'abonne sur `res` plutôt que sur `req`
  // car `req.close` est délicat à interpréter en supertest/Node moderne (il peut tomber
  // pendant la lecture du body). `res.close` couvre tous les cas de déconnexion client.
  const controller = new AbortController();
  let clientGone = false;
  let responseEnded = false;
  res.on("close", () => {
    clientGone = true;
    if (!responseEnded) controller.abort();
  });

  try {
    for await (const evt of streamPatientChat(parsed.data, controller.signal)) {
      if (clientGone) break;
      if (evt.type === "delta") {
        writeSseEvent(res, "delta", { text: evt.text });
      } else if (evt.type === "sentence") {
        writeSseEvent(res, "sentence", { text: evt.text, index: evt.index });
      } else if (evt.type === "done") {
        writeSseEvent(res, "done", { fullText: evt.fullText });
      } else if (evt.type === "speaker") {
        // Phase 4 J2 — émis avant le premier delta. L'UI met à jour son
        // currentSpeakerId / le label affiché sur la bulle en cours.
        writeSseEvent(res, "speaker", {
          speakerId: evt.speakerId,
          speakerRole: evt.speakerRole,
        });
      } else if (evt.type === "clarification_needed") {
        // Pas d'appel LLM ; on émet un seul event puis on ferme. L'UI ouvre
        // un panneau « À qui parlez-vous ? ».
        writeSseEvent(res, "clarification_needed", {
          reason: evt.reason,
          candidates: evt.candidates,
        });
      }
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      // Client parti → ne tente pas d'écrire un event error, le socket est fermé.
    } else if (err instanceof StationNotFoundError) {
      writeSseEvent(res, "error", { code: "bad_request", message: err.message });
    } else if ((err as Error).message === "OPENAI_API_KEY_MISSING") {
      writeSseEvent(res, "error", { code: "not_configured", message: "Clé OpenAI manquante." });
    } else {
      const mapped = mapUpstreamError(err);
      writeSseEvent(res, "error", { code: mapped.code, message: mapped.error, hint: mapped.hint });
    }
  } finally {
    responseEnded = true;
    res.end();
  }
});

// ───────── Brief (feuille de porte + phrase d'ouverture pour l'UI) ─────────

router.get("/:id/brief", async (req: Request, res: Response) => {
  try {
    const brief = await getPatientBrief(String(req.params.id));
    res.json(brief);
  } catch (err) {
    if (err instanceof StationNotFoundError) {
      return sendApiError(res, "bad_request", err.message);
    }
    return sendApiError(res, "internal_error", (err as Error).message);
  }
});

// ───────── Pedagogy (Phase 11 J2) ─────────
//
// GET /api/patient/:stationId/pedagogy — bloc pédagogique additif consommé
// par le rendu PDF post-évaluation (Phase 11 J4) et, le cas échéant, par
// une vue UI dédiée. Strictement séparé du brief (invariant I14) pour
// éviter toute fuite d'indices factuels durant la consultation.
//
// Réponses :
//   • 200 + { stationId, pedagogicalContent: PedagogicalContent | null }
//   • 400 + { error, code: "bad_request" } si la station est inconnue
//   • 500 si le bloc présent en base est malformé (validation Zod)
//
// Header Cache-Control: no-store — le bloc peut évoluer entre deux phases
// du corpus (J3 enrichira), on ne veut pas qu'un proxy CDN serve une
// version périmée. Pas d'auth en J2 (Phase 12).
router.get("/:stationId/pedagogy", async (req: Request, res: Response) => {
  try {
    const payload = await getPatientPedagogy(String(req.params.stationId));
    res.setHeader("Cache-Control", "no-store");
    return res.json(payload);
  } catch (err) {
    if (err instanceof StationNotFoundError) {
      return sendApiError(res, "bad_request", err.message);
    }
    return sendApiError(res, "internal_error", (err as Error).message);
  }
});

// ───────── STT (Whisper) ─────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.post("/stt", upload.single("audio"), async (req: Request, res: Response) => {
  const key = getOpenAIKey();
  if (!key) return sendApiError(res, "not_configured", "Clé OpenAI manquante.");
  if (!req.file) return sendApiError(res, "bad_request", "Champ 'audio' (multipart) manquant.");

  const started = Date.now();
  // Estimation grossière de la durée audio : on ne veut pas décompresser le webm ici.
  // Whisper est facturé à la minute réelle ; cette estimation sert uniquement au log.
  // 16 kB/s est un ordre de grandeur OK pour Opus mono à 24 kbps effectifs.
  const durationSec = req.file.size / (16 * 1024);

  try {
    const client = new OpenAI({ apiKey: key });
    const file = await toFile(req.file.buffer, req.file.originalname || "audio.webm", {
      type: req.file.mimetype || "audio/webm",
    });
    const result = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "fr",
    });
    const text = typeof result === "string" ? result : result.text;
    void logRequest({
      route: "/api/patient/stt",
      model: "whisper-1",
      tokensIn: 0,
      tokensOut: 0,
      cachedTokens: 0,
      latencyMs: Date.now() - started,
      durationSec,
      ok: true,
    });
    return res.json({ text });
  } catch (err) {
    void logRequest({
      route: "/api/patient/stt",
      model: "whisper-1",
      tokensIn: 0, tokensOut: 0, cachedTokens: 0,
      latencyMs: Date.now() - started,
      durationSec,
      ok: false,
    });
    return sendUpstreamError(res, err);
  }
});

// ───────── TTS ─────────

const TtsBody = z.object({
  text: z.string().min(1).max(4096),
  voice: z.enum(["alloy", "echo", "fable", "nova", "onyx", "shimmer"]).default("nova"),
});

router.post("/tts", async (req: Request, res: Response) => {
  const parsed = TtsBody.safeParse(req.body);
  if (!parsed.success) {
    return sendApiError(res, "bad_request", "Payload /tts invalide.", parsed.error.issues[0]?.message);
  }
  const key = getOpenAIKey();
  if (!key) return sendApiError(res, "not_configured", "Clé OpenAI manquante.");

  // Nettoie le texte AVANT l'appel TTS pour ne pas faire prononcer les emojis.
  const cleaned = sanitizeForTts(parsed.data.text);
  if (!cleaned) {
    return sendApiError(res, "bad_request", "Le texte est vide après nettoyage des caractères non prononçables.");
  }

  const started = Date.now();
  try {
    const client = new OpenAI({ apiKey: key });
    const response = await client.audio.speech.create({
      model: "tts-1",
      voice: parsed.data.voice,
      input: cleaned,
      response_format: "mp3",
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buffer.length.toString());
    res.setHeader("Cache-Control", "no-store");
    void logRequest({
      route: "/api/patient/tts",
      model: "tts-1",
      tokensIn: 0, tokensOut: 0, cachedTokens: 0,
      latencyMs: Date.now() - started,
      charCount: cleaned.length,
      ok: true,
    });
    return res.end(buffer);
  } catch (err) {
    void logRequest({
      route: "/api/patient/tts",
      model: "tts-1",
      tokensIn: 0, tokensOut: 0, cachedTokens: 0,
      latencyMs: Date.now() - started,
      charCount: cleaned.length,
      ok: false,
    });
    return sendUpstreamError(res, err);
  }
});

export default router;
