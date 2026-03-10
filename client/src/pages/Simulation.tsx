import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { MOCK_STATIONS } from "@/lib/mockData";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Play, Square, Mic, MicOff, Clock, Activity, AlertCircle, HeartPulse, FileAudio, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

// 13 minutes = 780 seconds
const TOTAL_DURATION = 13 * 60;
const ANNOUNCEMENT_11_MIN = 2 * 60; // 2 minutes left

export default function Simulation() {
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const stationId = searchParams.get('station');
  
  const station = MOCK_STATIONS.find(s => s.id === stationId) || MOCK_STATIONS[0];
  
  const [isActive, setIsActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(TOTAL_DURATION);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<{role: 'patient'|'doctor', text: string}[]>([]);
  const [announcementPlayed, setAnnouncementPlayed] = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => {
          const newTime = prev - 1;
          
          // Trigger announcements
          if (newTime === ANNOUNCEMENT_11_MIN && !announcementPlayed) {
            speak("Il vous reste 2 minutes");
            setAnnouncementPlayed(true);
          }
          if (newTime === 0) {
            speak("Fin de la station");
            setIsActive(false);
            setIsRecording(false);
          }
          
          return newTime;
        });
      }, 1000);
    } else if (timeLeft === 0 && isActive) {
      setIsActive(false);
      setIsRecording(false);
    }
    
    return () => clearInterval(interval);
  }, [isActive, timeLeft, announcementPlayed]);

  const speak = (text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'fr-FR';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleStart = () => {
    setIsActive(true);
    setIsRecording(true);
    // Add opening line if transcript is empty
    if (transcript.length === 0) {
      setTranscript([{ role: 'patient', text: station.openingLine }]);
      speak(station.openingLine);
    }
  };

  const handleStop = () => {
    setIsActive(false);
    setIsRecording(false);
  };

  const handleDebrief = () => {
    setLocation(`/evaluation?station=${station.id}`);
  };

  // Mock adding some text occasionally when recording
  useEffect(() => {
    if (isRecording) {
      const timer = setInterval(() => {
        if (Math.random() > 0.7) {
          setTranscript(prev => [
            ...prev, 
            { role: 'doctor', text: "Pouvez-vous m'en dire plus sur la douleur ?" },
            { role: 'patient', text: "Ça me serre très fort..." }
          ]);
        }
      }, 8000);
      return () => clearInterval(timer);
    }
  }, [isRecording]);

  const progressPercentage = ((TOTAL_DURATION - timeLeft) / TOTAL_DURATION) * 100;
  const isWarningTime = timeLeft <= 120 && timeLeft > 0;
  const isCriticalTime = timeLeft <= 30 && timeLeft > 0;

  return (
    <div className="h-full flex flex-col md:flex-row bg-muted/30">
      {/* Left Panel: Station Information */}
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
              <div className="bg-muted p-4 rounded-xl border border-border/50">
                <span className="text-sm text-muted-foreground block mb-1">FC</span>
                <span className="text-xl font-semibold text-primary">{station.vitals.hr}</span>
              </div>
              <div className="bg-muted p-4 rounded-xl border border-border/50">
                <span className="text-sm text-muted-foreground block mb-1">TA</span>
                <span className="text-xl font-semibold text-primary">{station.vitals.bp}</span>
              </div>
              <div className="bg-muted p-4 rounded-xl border border-border/50">
                <span className="text-sm text-muted-foreground block mb-1">FR</span>
                <span className="text-xl font-semibold text-primary">{station.vitals.rr}</span>
              </div>
              <div className="bg-muted p-4 rounded-xl border border-border/50">
                <span className="text-sm text-muted-foreground block mb-1">SpO2</span>
                <span className="text-xl font-semibold text-primary">{station.vitals.spo2}</span>
              </div>
              <div className="bg-muted p-4 rounded-xl border border-border/50 col-span-2">
                <span className="text-sm text-muted-foreground block mb-1">Température</span>
                <span className="text-xl font-semibold text-primary">{station.vitals.temp}</span>
              </div>
            </div>
          </div>
          
          <Separator />
          
          <div>
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">Contexte (Non visible par l'étudiant)</h3>
            <p className="text-base text-muted-foreground italic bg-amber-50 p-4 rounded-xl border border-amber-200 text-amber-900">{station.context}</p>
          </div>
        </div>
      </div>

      {/* Right Panel: Active Simulation & Timer */}
      <div className="w-full md:w-2/3 flex flex-col h-full bg-background relative">
        {/* Top Bar: Timer */}
        <div className="bg-card border-b border-border p-6 shadow-sm flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className={cn(
              "flex items-center justify-center font-mono text-5xl font-bold tabular-nums tracking-tighter px-6 py-4 rounded-2xl transition-colors duration-300",
              isCriticalTime ? "bg-red-100 text-red-700 animate-pulse border-2 border-red-300" :
              isWarningTime ? "bg-amber-100 text-amber-700 border-2 border-amber-300" : 
              "bg-secondary/50 text-secondary-foreground"
            )}>
              {formatTime(timeLeft)}
            </div>
            {isWarningTime && !isCriticalTime && (
              <div className="flex items-center text-amber-600 font-medium bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
                <AlertCircle className="w-5 h-5 mr-2" />
                Dernières minutes
              </div>
            )}
          </div>
          
          <div className="flex gap-3">
            {!isActive && timeLeft > 0 ? (
              <Button onClick={handleStart} size="lg" className="h-16 px-8 text-xl rounded-2xl shadow-lg bg-green-600 hover:bg-green-700 text-white">
                <Play className="w-6 h-6 mr-3 fill-current" /> Démarrer
              </Button>
            ) : isActive ? (
              <Button onClick={handleStop} variant="destructive" size="lg" className="h-16 px-8 text-xl rounded-2xl shadow-lg">
                <Square className="w-6 h-6 mr-3 fill-current" /> Arrêter
              </Button>
            ) : (
              <Button onClick={handleDebrief} size="lg" className="h-16 px-8 text-xl rounded-2xl shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground">
                <CheckCircle2 className="w-6 h-6 mr-3" /> Évaluer
              </Button>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="h-2 w-full bg-secondary">
          <div 
            className={cn(
              "h-full transition-all duration-1000 linear",
              isCriticalTime ? "bg-red-500" : isWarningTime ? "bg-amber-500" : "bg-primary"
            )}
            style={{ width: `${progressPercentage}%` }}
          />
        </div>

        {/* Transcript Area */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-6">
          {transcript.length === 0 && !isActive ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-60">
              <Mic className="w-20 h-20 mb-6 text-border" />
              <p className="text-2xl font-medium">La simulation n'a pas commencé</p>
              <p className="text-lg mt-2">Appuyez sur Démarrer pour lancer l'enregistrement</p>
            </div>
          ) : (
            <div className="space-y-6 max-w-4xl mx-auto w-full">
              <div className="text-center mb-8">
                <Badge variant="outline" className="px-4 py-1.5 text-sm bg-background">
                  {isRecording ? "Enregistrement en cours..." : "Enregistrement terminé"}
                  {isRecording && <span className="ml-2 w-2 h-2 rounded-full bg-red-500 inline-block animate-pulse" />}
                </Badge>
              </div>
              
              {transcript.map((msg, idx) => (
                <div key={idx} className={cn(
                  "flex flex-col max-w-[85%] animate-in fade-in slide-in-from-bottom-2",
                  msg.role === 'patient' ? "items-start" : "items-end ml-auto"
                )}>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 px-2">
                    {msg.role === 'patient' ? 'Patient (Voix IA)' : 'Étudiant / Médecin'}
                  </span>
                  <div className={cn(
                    "p-5 rounded-3xl text-lg shadow-sm border",
                    msg.role === 'patient' 
                      ? "bg-white border-border/50 text-foreground rounded-tl-sm" 
                      : "bg-primary text-primary-foreground border-primary/20 rounded-tr-sm"
                  )}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isActive && isRecording && (
                <div className="flex items-end ml-auto max-w-[85%] opacity-50">
                  <div className="p-5 rounded-3xl text-lg bg-primary text-primary-foreground rounded-tr-sm flex space-x-2">
                    <span className="animate-bounce">.</span><span className="animate-bounce delay-100">.</span><span className="animate-bounce delay-200">.</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}