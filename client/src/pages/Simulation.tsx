import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { MOCK_STATIONS, type Station } from "@/lib/mockData";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Play, Square, Mic, MicOff, AlertCircle, HeartPulse, FileAudio, CheckCircle2, Loader2, Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import { getPreferredVoice } from "@/lib/preferences";
import { ApiError, chatPatient, sttPatient, ttsPatient } from "@/lib/api";

const TOTAL_DURATION = 13 * 60;
const ANNOUNCEMENT_11_MIN = 2 * 60;

type TranscriptTurn = { role: "patient" | "doctor"; text: string };

// Annonces système (timer) — on garde le TTS navigateur pour éviter des appels API inutiles.
function systemAnnounce(text: string) {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }
}

export default function Simulation() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const searchParams = new URLSearchParams(window.location.search);
  const stationId = searchParams.get("station");
  const station: Station = MOCK_STATIONS.find((s) => s.id === stationId) || MOCK_STATIONS[0];

  const [isActive, setIsActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(TOTAL_DURATION);
  const [announcementPlayed, setAnnouncementPlayed] = useState(false);

  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [textInput, setTextInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [patientAudioUrl, setPatientAudioUrl] = useState<string | null>(null);

  const { isRecording, error: recorderError, start: startRec, stop: stopRec } = useMediaRecorder();
  const voice = useRef(getPreferredVoice());
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

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

  // Auto-scroll des nouvelles bulles.
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript, isSending, isTranscribing]);

  // Libère les ObjectURL TTS quand on change d'audio.
  useEffect(() => () => {
    if (patientAudioUrl) URL.revokeObjectURL(patientAudioUrl);
  }, [patientAudioUrl]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Construit l'historique pour /chat à partir du transcript (mapping des rôles).
  const buildHistory = useCallback((extra: TranscriptTurn[] = []): Array<{ role: "user" | "assistant"; content: string }> => {
    return [...transcript, ...extra].map((t) => ({
      role: t.role === "doctor" ? "user" : "assistant",
      content: t.text,
    }));
  }, [transcript]);

  // Lit l'audio TTS. Ignore silencieusement les erreurs d'autoplay.
  const playPatientAudio = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    setPatientAudioUrl(url);
    // Replay via l'élément audio non visible pour garder un contrôle simple.
    const audio = audioElementRef.current;
    if (audio) {
      audio.src = url;
      audio.play().catch(() => { /* autoplay peut être bloqué, l'utilisateur peut cliquer sur play */ });
    }
  }, []);

  // Envoie un message "médecin" → appelle /chat puis /tts. Déclenché par micro OU texte.
  const sendDoctorMessage = useCallback(async (doctorText: string) => {
    const cleaned = doctorText.trim();
    if (!cleaned) return;
    setIsSending(true);
    const newTurn: TranscriptTurn = { role: "doctor", text: cleaned };
    setTranscript((prev) => [...prev, newTurn]);

    try {
      const { reply } = await chatPatient({
        station: {
          scenario: station.scenario,
          context: station.context,
          vitals: station.vitals,
          openingLine: station.openingLine,
        },
        history: buildHistory([newTurn]),
        userMessage: cleaned,
      });

      setTranscript((prev) => [...prev, { role: "patient", text: reply }]);

      try {
        const audio = await ttsPatient(reply, voice.current);
        playPatientAudio(audio);
      } catch (err) {
        // Pas bloquant : on affiche le texte même si le TTS échoue.
        const e = err as ApiError;
        toast({
          title: "Synthèse vocale indisponible",
          description: `${e.message}${e.hint ? ` — ${e.hint}` : ""}`,
          variant: "destructive",
        });
      }
    } catch (err) {
      const e = err as ApiError;
      toast({
        title: "Le patient n'a pas pu répondre",
        description: `${e.message}${e.hint ? ` — ${e.hint}` : ""}`,
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  }, [buildHistory, playPatientAudio, station, toast]);

  const handleStart = useCallback(async () => {
    setIsActive(true);
    if (transcript.length === 0) {
      setTranscript([{ role: "patient", text: station.openingLine }]);
      try {
        const audio = await ttsPatient(station.openingLine, voice.current);
        playPatientAudio(audio);
      } catch {
        // En cas d'échec TTS au démarrage, on n'interrompt pas la session.
      }
    }
  }, [playPatientAudio, station.openingLine, transcript.length]);

  const handleStop = () => {
    setIsActive(false);
  };

  // Navigation vers évaluation : on persiste le transcript pour la page suivante.
  const handleDebrief = () => {
    try {
      sessionStorage.setItem(
        `osce.session.${station.id}`,
        JSON.stringify({ station, transcript }),
      );
    } catch { /* sessionStorage peut être désactivé */ }
    setLocation(`/evaluation?station=${station.id}`);
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
            await sendDoctorMessage(text);
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
        toast({
          title: "Accès au micro refusé",
          description: (err as Error).message,
          variant: "destructive",
        });
      }
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isActive || !textInput.trim() || isSending) return;
    const msg = textInput;
    setTextInput("");
    await sendDoctorMessage(msg);
  };

  const progressPercentage = ((TOTAL_DURATION - timeLeft) / TOTAL_DURATION) * 100;
  const isWarningTime = timeLeft <= 120 && timeLeft > 0;
  const isCriticalTime = timeLeft <= 30 && timeLeft > 0;
  const timedOut = timeLeft === 0;
  const inputsDisabled = !isActive || timedOut || isSending || isTranscribing;

  return (
    <div className="h-full flex flex-col md:flex-row bg-muted/30">
      {/* Élément audio caché pour le TTS patient. */}
      <audio ref={audioElementRef} className="hidden" data-testid="audio-patient" />

      {/* Panneau gauche : info station */}
      <div className="w-full md:w-1/3 border-r border-border bg-card overflow-y-auto shadow-sm z-10 flex flex-col">
        <div className="p-6 bg-primary/5 border-b border-primary/10">
          <div className="flex gap-2 mb-3">
            <Badge variant="outline" className="bg-white">{station.source}</Badge>
            <Badge variant="secondary">{station.specialty}</Badge>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{station.title}</h2>
        </div>

        <div className="p-6 space-y-8 flex-1">
          <div>
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center">
              <FileAudio className="w-4 h-4 mr-2" /> Scénario
            </h3>
            <p className="text-lg leading-relaxed">{station.scenario}</p>
          </div>

          <Separator />

          <div>
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center">
              <HeartPulse className="w-4 h-4 mr-2" /> Signes Vitaux
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "FC", value: station.vitals.hr },
                { label: "TA", value: station.vitals.bp },
                { label: "FR", value: station.vitals.rr },
                { label: "SpO2", value: station.vitals.spo2 },
              ].map((v) => (
                <div key={v.label} className="bg-muted p-4 rounded-xl border border-border/50">
                  <span className="text-sm text-muted-foreground block mb-1">{v.label}</span>
                  <span className="text-xl font-semibold text-primary">{v.value}</span>
                </div>
              ))}
              <div className="bg-muted p-4 rounded-xl border border-border/50 col-span-2">
                <span className="text-sm text-muted-foreground block mb-1">Température</span>
                <span className="text-xl font-semibold text-primary">{station.vitals.temp}</span>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">Contexte (non visible par l'étudiant)</h3>
            <p className="text-base text-muted-foreground italic bg-amber-50 p-4 rounded-xl border border-amber-200 text-amber-900">{station.context}</p>
          </div>
        </div>
      </div>

      {/* Panneau droit : timer + transcript + input */}
      <div className="w-full md:w-2/3 flex flex-col h-full bg-background relative">
        {/* Barre timer + actions principales */}
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
            {!isActive && !timedOut && transcript.length === 0 ? (
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

        {/* Barre de progression */}
        <div className="h-2 w-full bg-secondary">
          <div
            className={cn(
              "h-full transition-all duration-1000 linear",
              isCriticalTime ? "bg-red-500" : isWarningTime ? "bg-amber-500" : "bg-primary",
            )}
            style={{ width: `${progressPercentage}%` }}
          />
        </div>

        {/* Transcript */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-6">
          {transcript.length === 0 && !isActive ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-60">
              <Mic className="w-20 h-20 mb-6 text-border" />
              <p className="text-2xl font-medium">La simulation n'a pas commencé</p>
              <p className="text-lg mt-2">Appuyez sur Démarrer pour lancer l'enregistrement</p>
            </div>
          ) : (
            <div className="space-y-6 max-w-4xl mx-auto w-full">
              <div className="text-center mb-4">
                <Badge variant="outline" className="px-4 py-1.5 text-sm bg-background">
                  {isRecording ? "Enregistrement…" :
                   isTranscribing ? "Transcription…" :
                   isSending ? "Le patient réfléchit…" :
                   timedOut ? "Station terminée" :
                   isActive ? "En cours" : "En pause"}
                  {(isRecording || isTranscribing || isSending) && (
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
                    {msg.role === "patient" ? "Patient (voix IA)" : "Étudiant / Médecin"}
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

              {(isSending || isTranscribing) && (
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

        {/* Barre d'input : micro + texte alternatif */}
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
              disabled={!isActive || timedOut || isSending || isTranscribing}
              size="lg"
              variant={isRecording ? "destructive" : "default"}
              className="shrink-0 h-14 w-14 rounded-full p-0"
              aria-label={isRecording ? "Arrêter l'enregistrement" : "Démarrer l'enregistrement"}
              data-testid="button-mic"
            >
              {isRecording ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </Button>
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
