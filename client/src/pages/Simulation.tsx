import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Play, Square, Mic, MicOff, AlertCircle, HeartPulse, FileAudio, CheckCircle2, Loader2, Send, ArrowLeft, Headphones as HeadphonesIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import { useStreamingChat } from "@/hooks/useStreamingChat";
import { useConversationMode } from "@/hooks/useConversationMode";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { MicLevelIndicator } from "@/components/MicLevelIndicator";
import {
  getConversationPreferences,
  getPreferredVoice,
  getVoicePreferences,
  interlocutorArticle,
  interlocutorSpeakerLabel,
  resolveVoice,
} from "@/lib/preferences";
import { canonicalSetting } from "@/lib/settingGroups";
import {
  ApiError,
  chatPatient,
  getPatientBrief,
  sttPatient,
  ttsPatient,
  type PatientBrief,
  type TtsVoice,
} from "@/lib/api";

const TOTAL_DURATION = 13 * 60;
const ANNOUNCEMENT_11_MIN = 2 * 60;

type TranscriptTurn = { role: "patient" | "doctor"; text: string };

function systemAnnounce(text: string) {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }
}

// Libellés lisibles pour les clés de signes vitaux côté JSON (ta, fc, fr, spo2, temperature…).
const VITAL_LABELS: Record<string, string> = {
  ta: "TA",
  fc: "FC",
  fr: "FR",
  temperature: "Temp",
  temp: "Temp",
  spo2: "SpO2",
  glycemie: "Glycémie",
  etat: "État",
  douleur: "Douleur",
};

export default function Simulation() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const searchParams = new URLSearchParams(window.location.search);
  const stationId = searchParams.get("station");

  const [brief, setBrief] = useState<PatientBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isActive, setIsActive] = useState(false);
  // Une fois true, reste true jusqu'au démontage. Pilote l'affichage de la feuille de
  // porte (PATIENT + SIGNES VITAUX) — cachée avant tout clic sur « Démarrer ».
  const [hasStarted, setHasStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(TOTAL_DURATION);
  const [announcementPlayed, setAnnouncementPlayed] = useState(false);

  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [textInput, setTextInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const { isRecording, error: recorderError, start: startRec, stop: stopRec } = useMediaRecorder();
  // Voix TTS du patient — état initial = fallback preferredVoice ; résolu en fonction du
  // sexe/âge du brief dès qu'il est chargé (cf. useEffect ci-dessous).
  const [voice, setVoice] = useState<TtsVoice>(() => getPreferredVoice());
  const voiceRef = useRef<TtsVoice>(voice);
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const streaming = useStreamingChat({ voice });
  const {
    sendMessage: sendStream,
    abort: abortStream,
    isStreaming,
    partialText,
    isAudioPlaying: isStreamAudioPlaying,
  } = streaming;

  // Mode conversation — activable depuis la Simulation seulement si l'utilisateur a
  // coché "Activer le mode conversation" dans Settings. Toggle ON au niveau Simulation
  // = démarrage effectif du VAD.
  const convPrefs = useRef(getConversationPreferences());
  const [conversationMode, setConversationMode] = useState(false);
  // Suspendre le VAD pendant que le patient parle (stream en cours, TTS en cours, son
  // de fallback en cours) pour éviter le larsen.
  const [isFallbackAudioPlaying, setIsFallbackAudioPlaying] = useState(false);
  const patientSpeaking = isStreaming || isStreamAudioPlaying || isFallbackAudioPlaying || isSending || isTranscribing;

  // Chargement initial du brief (feuille de porte + phrase d'ouverture).
  useEffect(() => {
    if (!stationId) {
      setLoadError("Paramètre ?station manquant.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const b = await getPatientBrief(stationId);
        if (cancelled) return;
        setBrief(b);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof ApiError ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [stationId]);

  // Résolution de la voix dès que le brief est chargé : choisit maleVoice / femaleVoice
  // selon `brief.sex` (+ cas pédiatrique si age < 12) ou preferredVoice si auto OFF.
  useEffect(() => {
    if (!brief) return;
    const prefs = getVoicePreferences();
    setVoice(resolveVoice(brief, prefs));
  }, [brief]);

  // Timer
  useEffect(() => {
    if (!isActive) return;
    const interval = window.setInterval(() => {
      setTimeLeft((prev) => {
        const next = prev - 1;
        if (next === ANNOUNCEMENT_11_MIN && !announcementPlayed) {
          systemAnnounce("Il vous reste 2 minutes");
          setAnnouncementPlayed(true);
        }
        if (next === 0) {
          systemAnnounce("Fin de la station");
          setIsActive(false);
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isActive, announcementPlayed]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript, isSending, isTranscribing, partialText]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const buildHistory = useCallback((extra: TranscriptTurn[] = []): Array<{ role: "user" | "assistant"; content: string }> => {
    return [...transcript, ...extra].map((t) => ({
      role: t.role === "doctor" ? "user" : "assistant",
      content: t.text,
    }));
  }, [transcript]);

  const playAudio = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const audio = audioElementRef.current;
    if (audio) {
      audio.src = url;
      audio.onplay = () => setIsFallbackAudioPlaying(true);
      audio.onended = () => {
        setIsFallbackAudioPlaying(false);
        URL.revokeObjectURL(url);
      };
      audio.onpause = () => setIsFallbackAudioPlaying(false);
      audio.play().catch(() => { /* autoplay peut être bloqué avant première interaction */ });
    }
  }, []);

  const sendDoctorMessage = useCallback(async (doctorText: string, mode: "voice" | "text") => {
    if (!stationId) return;
    const cleaned = doctorText.trim();
    if (!cleaned) return;
    setIsSending(true);
    const newTurn: TranscriptTurn = { role: "doctor", text: cleaned };
    setTranscript((prev) => [...prev, newTurn]);

    const input = {
      stationId,
      history: buildHistory([newTurn]),
      userMessage: cleaned,
      mode,
    };

    try {
      // Chemin streaming : affichage token-par-token + TTS progressif des phrases.
      const { fullText, aborted } = await sendStream(input);
      if (aborted) return;

      if (fullText && fullText.trim().length > 0) {
        setTranscript((prev) => [...prev, { role: "patient", text: fullText }]);
      } else {
        // Filet de sécurité : le stream a terminé sans erreur mais sans contenu
        // (ex. route SSE non montée et interceptée plus haut par notre garde content-type,
        // ou panne silencieuse upstream). On bascule sur l'endpoint non-stream + TTS manuel
        // pour ne pas bloquer la simulation.
        const { reply } = await chatPatient(input);
        setTranscript((prev) => [...prev, { role: "patient", text: reply }]);
        try {
          const audio = await ttsPatient(reply, voiceRef.current);
          playAudio(audio);
        } catch { /* TTS optionnel */ }
      }
    } catch (err) {
      const e = err as ApiError;
      // Fallback non-streaming : si le stream a échoué (réseau, proxy, erreur upstream,
      // content-type invalide), on réessaie l'endpoint classique pour ne pas bloquer la
      // simulation.
      try {
        const { reply } = await chatPatient(input);
        setTranscript((prev) => [...prev, { role: "patient", text: reply }]);
        try {
          const audio = await ttsPatient(reply, voiceRef.current);
          playAudio(audio);
        } catch { /* TTS optionnel — on ne bloque pas l'échange */ }
      } catch (err2) {
        const e2 = err2 as ApiError;
        toast({
          title: "Le patient n'a pas pu répondre",
          description: `${e2.message ?? e.message}${e2.hint ? ` — ${e2.hint}` : ""}`,
          variant: "destructive",
        });
      }
    } finally {
      setIsSending(false);
    }
  }, [buildHistory, playAudio, sendStream, stationId, toast]);

  // Hook de mode conversation : VAD écoute en continu pendant que l'utilisateur parle,
  // capture l'audio, émet un blob dès qu'un silence prolongé est détecté, et on enchaîne
  // automatiquement STT → sendDoctorMessage. Le hook est suspendu pendant que le patient
  // parle (patientSpeaking) pour éviter que la voix TTS soit captée et retranscrite.
  const conversation = useConversationMode({
    silenceThresholdMs: convPrefs.current.silenceThresholdMs,
    minSpeechDurationMs: convPrefs.current.minSpeechDurationMs,
    suspended: patientSpeaking,
    onUtteranceComplete: async (clip) => {
      setIsTranscribing(true);
      try {
        const { text } = await sttPatient(clip.blob, clip.filename);
        if (text.trim().length > 0) {
          await sendDoctorMessage(text, "voice");
        }
      } catch (err) {
        const e = err as ApiError;
        toast({
          title: "Transcription impossible",
          description: `${e.message}${e.hint ? ` — ${e.hint}` : ""}`,
          variant: "destructive",
        });
      } finally {
        setIsTranscribing(false);
      }
    },
    onError: (err) => {
      toast({ title: "Mode conversation interrompu", description: err.message, variant: "destructive" });
    },
  });

  const toggleConversationMode = useCallback(async () => {
    if (conversationMode) {
      conversation.stop();
      setConversationMode(false);
      return;
    }
    try {
      await conversation.start();
      setConversationMode(true);
    } catch (err) {
      toast({
        title: "Accès au micro refusé",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  }, [conversation, conversationMode, toast]);

  // Démarre la station sans message initial : en OSCE, le candidat (médecin) parle
  // toujours en premier. Le patient simulé ne répondra qu'après la première question.
  // La phrase d'ouverture scénaristique (brief.phraseOuverture) reste disponible côté
  // service pour le system prompt, mais n'est pas jouée automatiquement ici.
  const handleStart = useCallback(() => {
    if (!brief) return;
    setHasStarted(true);
    setIsActive(true);
  }, [brief]);

  const handleStop = () => {
    abortStream();
    setIsActive(false);
    if (conversationMode) {
      conversation.stop();
      setConversationMode(false);
    }
  };

  // Coupe automatiquement le mode conversation à la fin du timer, pour éviter qu'il
  // reste actif après "Fin de station".
  useEffect(() => {
    if (timeLeft === 0 && conversationMode) {
      conversation.stop();
      setConversationMode(false);
    }
  }, [timeLeft, conversationMode, conversation]);

  // Raccourcis clavier :
  //   - M : toggle mode conversation (si activé dans Settings et simulation en cours)
  //   - Échap : coupe toujours le mode conversation (n'active jamais)
  // Affiche un toast discret pour que l'utilisateur sache qu'il a bien tapé la bonne touche.
  useKeyboardShortcuts(
    {
      m: () => {
        if (!convPrefs.current.enabled) return;
        void toggleConversationMode();
        toast({
          title: conversationMode ? "Mode conversation suspendu (M)" : "Mode conversation activé (M)",
          duration: 1500,
        });
      },
      Escape: () => {
        if (conversationMode) {
          conversation.stop();
          setConversationMode(false);
          toast({ title: "Mode conversation coupé (Échap)", duration: 1500 });
        }
      },
    },
    { enabled: isActive && timeLeft > 0 },
  );

  const handleDebrief = () => {
    if (!stationId || !brief) return;
    try {
      sessionStorage.setItem(
        `osce.session.${stationId}`,
        JSON.stringify({ stationId, brief, transcript }),
      );
    } catch { /* sessionStorage peut être désactivé */ }
    setLocation(`/evaluation?station=${encodeURIComponent(stationId)}`);
  };

  const handleMicClick = async () => {
    if (!isActive || timeLeft === 0) return;
    if (isRecording) {
      try {
        const clip = await stopRec();
        setIsTranscribing(true);
        try {
          const { text } = await sttPatient(clip.blob, clip.filename);
          if (text.trim().length > 0) {
            await sendDoctorMessage(text, "voice");
          } else {
            toast({ title: "Aucune voix détectée", description: "Rapprochez-vous du micro et réessayez." });
          }
        } catch (err) {
          const e = err as ApiError;
          toast({
            title: "Transcription impossible",
            description: `${e.message}${e.hint ? ` — ${e.hint}` : ""}`,
            variant: "destructive",
          });
        } finally {
          setIsTranscribing(false);
        }
      } catch (err) {
        toast({ title: "Enregistrement interrompu", description: (err as Error).message, variant: "destructive" });
      }
    } else {
      try {
        await startRec();
      } catch (err) {
        toast({ title: "Accès au micro refusé", description: (err as Error).message, variant: "destructive" });
      }
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isActive || !textInput.trim() || isSending) return;
    const msg = textInput;
    setTextInput("");
    await sendDoctorMessage(msg, "text");
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-6 h-6 mr-2 animate-spin" /> Chargement de la station…
      </div>
    );
  }

  if (loadError || !brief || !stationId) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Button variant="ghost" onClick={() => setLocation("/")} className="mb-4">
          <ArrowLeft className="w-5 h-5 mr-2" /> Retour à la bibliothèque
        </Button>
        <h1 className="text-2xl font-bold mb-2">Station indisponible</h1>
        <p className="text-red-700">{loadError ?? "Station inconnue."}</p>
      </div>
    );
  }

  const progressPercentage = ((TOTAL_DURATION - timeLeft) / TOTAL_DURATION) * 100;
  const isWarningTime = timeLeft <= 120 && timeLeft > 0;
  const isCriticalTime = timeLeft <= 30 && timeLeft > 0;
  const timedOut = timeLeft === 0;
  const inputsDisabled = !isActive || timedOut || isSending || isTranscribing;

  return (
    <div className="h-full flex flex-col md:flex-row bg-muted/30">
      <audio ref={audioElementRef} className="hidden" data-testid="audio-patient" />

      {/* Panneau gauche : feuille de porte */}
      <div className="w-full md:w-1/3 border-r border-border bg-card overflow-y-auto shadow-sm z-10 flex flex-col">
        <div className="p-6 bg-primary/5 border-b border-primary/10">
          <div className="flex items-center gap-2 mb-3">
            <Badge variant="outline" className="bg-white font-mono">{stationId}</Badge>
            {brief.setting && <Badge variant="secondary">{canonicalSetting(brief.setting)}</Badge>}
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Feuille de porte</h2>
        </div>

        <div className="p-6 space-y-8 flex-1">
          {!hasStarted ? (
            // Contenu scellé : on ne révèle Patient + Signes vitaux qu'au clic sur Démarrer.
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground py-12">
              <FileAudio className="w-10 h-10 mb-4 text-border" />
              <p className="text-base font-medium max-w-[260px]">
                Appuyez sur <span className="text-foreground font-semibold">Démarrer</span> pour révéler la feuille de porte.
              </p>
            </div>
          ) : (
            <>
              {brief.patientDescription && (
                <>
                  <div>
                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center">
                      <FileAudio className="w-4 h-4 mr-2" /> Patient
                    </h3>
                    <p className="text-lg leading-relaxed">{brief.patientDescription}</p>
                    {brief.interlocutor?.type === "parent" && (
                      <p className="mt-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                        <span className="font-semibold">Interlocuteur :</span> {interlocutorArticle(brief)} répond à votre place — le patient ne s'exprime pas directement.
                      </p>
                    )}
                    {brief.interlocutor?.parentPresent && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Un parent est présent dans la pièce ; il peut intervenir pour préciser des éléments factuels.
                      </p>
                    )}
                  </div>
                  <Separator />
                </>
              )}

              {Object.keys(brief.vitals).length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center">
                    <HeartPulse className="w-4 h-4 mr-2" /> Signes vitaux
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(brief.vitals).map(([k, v]) => (
                      <div key={k} className="bg-muted p-4 rounded-xl border border-border/50">
                        <span className="text-sm text-muted-foreground block mb-1">{VITAL_LABELS[k] ?? k}</span>
                        <span className="text-lg font-semibold text-primary">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Panneau droit : timer + transcript + input */}
      <div className="w-full md:w-2/3 flex flex-col h-full bg-background relative">
        <div className="bg-card border-b border-border p-6 shadow-sm flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className={cn(
              "flex items-center justify-center font-mono text-5xl font-bold tabular-nums tracking-tighter px-6 py-4 rounded-2xl transition-colors duration-300",
              isCriticalTime ? "bg-red-100 text-red-700 animate-pulse border-2 border-red-300" :
              isWarningTime ? "bg-amber-100 text-amber-700 border-2 border-amber-300" :
              "bg-secondary/50 text-secondary-foreground",
            )}>
              {formatTime(timeLeft)}
            </div>
            {isWarningTime && !isCriticalTime && (
              <div className="flex items-center text-amber-600 font-medium bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
                <AlertCircle className="w-5 h-5 mr-2" /> Dernières minutes
              </div>
            )}
          </div>

          <div className="flex gap-3">
            {!isActive && !timedOut && !hasStarted ? (
              <Button onClick={handleStart} size="lg" className="h-16 px-8 text-xl rounded-2xl shadow-lg bg-green-600 hover:bg-green-700 text-white" data-testid="button-start">
                <Play className="w-6 h-6 mr-3 fill-current" /> Démarrer
              </Button>
            ) : isActive && !timedOut ? (
              <Button onClick={handleStop} variant="destructive" size="lg" className="h-16 px-8 text-xl rounded-2xl shadow-lg" data-testid="button-stop">
                <Square className="w-6 h-6 mr-3 fill-current" /> Arrêter
              </Button>
            ) : (
              <Button onClick={handleDebrief} size="lg" className="h-16 px-8 text-xl rounded-2xl shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground" data-testid="button-debrief">
                <CheckCircle2 className="w-6 h-6 mr-3" /> Évaluer
              </Button>
            )}
          </div>
        </div>

        <div className="h-2 w-full bg-secondary">
          <div
            className={cn(
              "h-full transition-all duration-1000 linear",
              isCriticalTime ? "bg-red-500" : isWarningTime ? "bg-amber-500" : "bg-primary",
            )}
            style={{ width: `${progressPercentage}%` }}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-6">
          {transcript.length === 0 && !hasStarted ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-60">
              <Mic className="w-20 h-20 mb-6 text-border" />
              <p className="text-2xl font-medium">La simulation n'a pas commencé</p>
              <p className="text-lg mt-2">Appuyez sur Démarrer pour lancer la station</p>
            </div>
          ) : transcript.length === 0 && !isStreaming && !isSending && !isTranscribing ? (
            // La station a démarré mais le candidat n'a pas encore parlé — en OSCE, c'est
            // le médecin qui ouvre l'entretien, le patient ne répond qu'ensuite.
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-70">
              <Mic className="w-16 h-16 mb-5 text-border" />
              <p className="text-xl font-medium">En attente de votre première question…</p>
              <p className="text-sm mt-2">Utilisez le micro ou tapez votre question ci-dessous.</p>
            </div>
          ) : (
            <div className="space-y-6 max-w-4xl mx-auto w-full">
              <div className="text-center mb-4">
                <Badge variant="outline" className="px-4 py-1.5 text-sm bg-background">
                  {isRecording ? "Enregistrement…" :
                   isTranscribing ? "Transcription…" :
                   isStreaming ? "Le patient parle…" :
                   isSending ? "Le patient réfléchit…" :
                   timedOut ? "Station terminée" :
                   isActive ? "En cours" : "En pause"}
                  {(isRecording || isTranscribing || isSending || isStreaming) && (
                    <span className="ml-2 w-2 h-2 rounded-full bg-red-500 inline-block animate-pulse" />
                  )}
                </Badge>
              </div>

              {transcript.map((msg, idx) => (
                <div key={idx} className={cn(
                  "flex flex-col max-w-[85%] animate-in fade-in slide-in-from-bottom-2",
                  msg.role === "patient" ? "items-start" : "items-end ml-auto",
                )}>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 px-2">
                    {msg.role === "patient" ? `${interlocutorSpeakerLabel(brief)} (voix IA)` : "Étudiant / Médecin"}
                  </span>
                  <div className={cn(
                    "p-5 rounded-3xl text-lg shadow-sm border",
                    msg.role === "patient"
                      ? "bg-white border-border/50 text-foreground rounded-tl-sm"
                      : "bg-primary text-primary-foreground border-primary/20 rounded-tr-sm",
                  )}>
                    {msg.text}
                  </div>
                </div>
              ))}

              {isStreaming && partialText && (
                <div className="flex flex-col max-w-[85%] items-start animate-in fade-in slide-in-from-bottom-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 px-2">
                    {interlocutorSpeakerLabel(brief)} (voix IA)
                  </span>
                  <div className="p-5 rounded-3xl text-lg shadow-sm border bg-white border-border/50 text-foreground rounded-tl-sm">
                    {partialText}
                    <span className="ml-1 inline-block w-2 h-5 bg-primary/60 align-middle animate-pulse" />
                  </div>
                </div>
              )}

              {((isSending && !isStreaming) || isTranscribing) && (
                <div className="flex items-start max-w-[85%] opacity-70">
                  <div className="p-5 rounded-3xl text-lg bg-white border rounded-tl-sm flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {isTranscribing ? "Reconnaissance vocale…" : "Le patient prépare sa réponse…"}
                  </div>
                </div>
              )}
              <div ref={scrollAnchorRef} />
            </div>
          )}
        </div>

        <div className="border-t border-border bg-card p-4 shrink-0">
          {recorderError && (
            <div className="mb-2 text-sm text-red-600 flex items-center gap-1">
              <AlertCircle className="w-4 h-4" /> {recorderError}
            </div>
          )}
          <form onSubmit={handleTextSubmit} className="flex items-center gap-3 max-w-4xl mx-auto">
            <Button
              type="button"
              onClick={handleMicClick}
              disabled={!isActive || timedOut || isSending || isTranscribing || conversationMode}
              size="lg"
              variant={isRecording ? "destructive" : "default"}
              className="shrink-0 h-14 w-14 rounded-full p-0"
              aria-label={isRecording ? "Arrêter l'enregistrement" : "Démarrer l'enregistrement"}
              data-testid="button-mic"
              title={conversationMode ? "Désactivé en mode conversation" : undefined}
            >
              {isRecording ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </Button>
            {convPrefs.current.enabled && (
              <Button
                type="button"
                onClick={toggleConversationMode}
                disabled={!isActive || timedOut}
                size="lg"
                variant={conversationMode ? "destructive" : "outline"}
                className="shrink-0 h-14 px-4 rounded-full gap-2"
                aria-label={conversationMode ? "Désactiver le mode conversation" : "Activer le mode conversation"}
                title={
                  conversationMode
                    ? "Mode conversation actif — M ou Échap pour arrêter"
                    : "Mode conversation (auto-silence) — M pour basculer"
                }
                data-testid="button-conversation-mode"
              >
                {conversationMode ? (
                  <MicLevelIndicator
                    state={conversation.state}
                    level={conversation.level}
                    className="w-16"
                  />
                ) : (
                  <HeadphonesIcon className="w-5 h-5" />
                )}
              </Button>
            )}
            <Input
              type="text"
              placeholder={isActive ? "Ou tapez votre question ici…" : "Démarrez la station pour interagir"}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              disabled={inputsDisabled}
              className="flex-1 h-14 text-lg rounded-xl"
              data-testid="input-text"
            />
            <Button
              type="submit"
              size="lg"
              disabled={inputsDisabled || textInput.trim().length === 0}
              className="shrink-0 h-14 rounded-xl"
              data-testid="button-send-text"
            >
              <Send className="w-5 h-5 mr-2" /> Envoyer
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
