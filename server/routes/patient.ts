// Routes "patient IA" côté OpenAI :
//   POST /api/patient/chat — conversation (GPT-4o-mini)
//   POST /api/patient/stt  — speech-to-text (Whisper)
//   POST /api/patient/tts  — text-to-speech (OpenAI TTS) — renvoie du mp3 streamé

import { Router, type Request, type Response } from "express";
import OpenAI, { toFile } from "openai";
import multer from "multer";
import { z } from "zod";

import { getOpenAIKey } from "../lib/config";
import { loadPrompt } from "../lib/prompts";
import { sendApiError, sendUpstreamError } from "../lib/errors";

const router = Router();

// ───────── Chat ─────────

const StationShape = z.object({
  scenario: z.string(),
  context: z.string().optional().default(""),
  vitals: z
    .object({
      hr: z.string().optional().default(""),
      bp: z.string().optional().default(""),
      rr: z.string().optional().default(""),
      temp: z.string().optional().default(""),
      spo2: z.string().optional().default(""),
    })
    .optional()
    .default({}),
  openingLine: z.string().optional(),
});

const ChatBody = z.object({
  station: StationShape,
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .default([]),
  userMessage: z.string().min(1),
});

// Substitue les {{placeholders}} dans le template markdown.
function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

router.post("/chat", async (req: Request, res: Response) => {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    return sendApiError(res, "bad_request", "Payload /chat invalide.", parsed.error.issues[0]?.message);
  }

  const key = getOpenAIKey();
  if (!key) {
    return sendApiError(
      res,
      "not_configured",
      "Clé OpenAI manquante.",
      "Ouvrez Paramètres et renseignez votre clé sk-…",
    );
  }

  try {
    const template = await loadPrompt("patient");
    const { station, history, userMessage } = parsed.data;
    const systemPrompt = renderPrompt(template, {
      scenario: station.scenario,
      context: station.context ?? "",
      hr: station.vitals?.hr ?? "",
      bp: station.vitals?.bp ?? "",
      rr: station.vitals?.rr ?? "",
      temp: station.vitals?.temp ?? "",
      spo2: station.vitals?.spo2 ?? "",
    });

    const client = new OpenAI({ apiKey: key });
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      max_tokens: 300,
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: userMessage },
      ],
    });

    const reply = completion.choices[0]?.message?.content?.trim() ?? "";
    return res.json({ reply });
  } catch (err) {
    return sendUpstreamError(res, err);
  }
});

// ───────── STT (Whisper) ─────────

// Stockage en mémoire : les audios de 3s pèsent quelques dizaines de Ko.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 Mo : limite OpenAI pour Whisper
});

router.post("/stt", upload.single("audio"), async (req: Request, res: Response) => {
  const key = getOpenAIKey();
  if (!key) {
    return sendApiError(res, "not_configured", "Clé OpenAI manquante.");
  }
  if (!req.file) {
    return sendApiError(res, "bad_request", "Champ 'audio' (multipart) manquant.");
  }

  try {
    const client = new OpenAI({ apiKey: key });
    // toFile transforme un Buffer en objet compatible avec l'API uploads.
    const file = await toFile(req.file.buffer, req.file.originalname || "audio.webm", {
      type: req.file.mimetype || "audio/webm",
    });
    const result = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "fr",
    });
    // Le retour typé peut être Transcription (JSON) ou string ; on normalise.
    const text = typeof result === "string" ? result : result.text;
    return res.json({ text });
  } catch (err) {
    return sendUpstreamError(res, err);
  }
});

// ───────── TTS ─────────

const TtsBody = z.object({
  text: z.string().min(1).max(4096),
  voice: z
    .enum(["alloy", "echo", "fable", "nova", "onyx", "shimmer"])
    .default("nova"),
});

router.post("/tts", async (req: Request, res: Response) => {
  const parsed = TtsBody.safeParse(req.body);
  if (!parsed.success) {
    return sendApiError(res, "bad_request", "Payload /tts invalide.", parsed.error.issues[0]?.message);
  }

  const key = getOpenAIKey();
  if (!key) {
    return sendApiError(res, "not_configured", "Clé OpenAI manquante.");
  }

  try {
    const client = new OpenAI({ apiKey: key });
    const response = await client.audio.speech.create({
      model: "tts-1",
      voice: parsed.data.voice,
      input: parsed.data.text,
      response_format: "mp3",
    });

    // response est une fetch Response standard ; on streame son body vers le client.
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buffer.length.toString());
    res.setHeader("Cache-Control", "no-store");
    return res.end(buffer);
  } catch (err) {
    return sendUpstreamError(res, err);
  }
});

export default router;
