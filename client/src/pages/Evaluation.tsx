import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Download, ArrowLeft, TrendingUp, Loader2, RotateCcw, FileText,
  ClipboardList, Lightbulb,
} from "lucide-react";
import {
  ApiError, evaluate, type EvaluationResult, type EvaluationScores, type PatientBrief,
  type StationType,
} from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ReportPdf } from "@/components/ReportPdf";
import { AccentedMarkdown } from "@/components/AccentedMarkdown";
import { stripRedundantSections } from "@/lib/reportFormatting";

interface Session {
  stationId: string;
  brief: PatientBrief;
  transcript: Array<{ role: "patient" | "doctor"; text: string }>;
}

function readSession(stationId: string): Session | null {
  try {
    const raw = sessionStorage.getItem(`osce.session.${stationId}`);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

// Libellés user-friendly des 6 station_type inférés (Phase 2). Affichés dans
// le header de la page évaluation à côté du titre « Performance Globale ».
const STATION_TYPE_LABELS: Record<StationType, string> = {
  anamnese_examen: "Anamnèse-examen",
  bbn: "Annonce mauvaise nouvelle (BBN)",
  psy: "Entretien psychiatrique",
  pediatrie_accompagnant: "Pédiatrie avec accompagnant",
  teleconsultation: "Téléconsultation",
  triage: "Triage",
};

function stationTypeLabel(t: StationType): string {
  return STATION_TYPE_LABELS[t] ?? t;
}

// Palette conditionnelle du verdict, partagée entre la carte synthèse et les
// barres de progression des axes.
type Tone = "green" | "amber" | "red";
function toneForScore(score: number): Tone {
  if (score >= 70) return "green";
  if (score >= 50) return "amber";
  return "red";
}
const TONE_CLASSES: Record<Tone, { text: string; bg: string; border: string; ring: string; progress: string }> = {
  green: {
    text: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    ring: "border-emerald-300",
    progress: "bg-emerald-500",
  },
  amber: {
    text: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
    ring: "border-amber-300",
    progress: "bg-amber-500",
  },
  red: {
    text: "text-red-700",
    bg: "bg-red-50",
    border: "border-red-200",
    ring: "border-red-300",
    progress: "bg-red-500",
  },
};

// Barre simple colorée selon le score (remplace le composant <Progress> par défaut
// qui n'accepte qu'une couleur unique).
function ScoreBar({ value }: { value: number }) {
  const tone = toneForScore(value);
  const safe = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full ${TONE_CLASSES[tone].progress} transition-all`}
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}

// Petits libellés injectés en préambule des h2 narratifs (détection par texte).
// Le prompt evaluator produit trois sections h2 : "DÉTAIL PAR SECTION",
// "ANALYSE QUALITATIVE" (où Points forts / Points à améliorer / Éléments
// critiques apparaissent en labels inline accentués), et "CONSEILS
// PERSONNALISÉS". Pas de h2 "POINTS FORTS" / "AXES D'AMÉLIORATION" séparés.
function sectionIcon(heading: string): React.ReactNode {
  const h = heading.toUpperCase();
  if (h.includes("DÉTAIL") || h.includes("DETAIL")) {
    return <ClipboardList className="w-5 h-5 text-primary" />;
  }
  if (h.includes("ANALYSE")) {
    return <FileText className="w-5 h-5 text-slate-700" />;
  }
  if (h.includes("CONSEIL")) return <Lightbulb className="w-5 h-5 text-blue-600" />;
  return null;
}

export default function Evaluation() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const searchParams = new URLSearchParams(window.location.search);
  const stationId = searchParams.get("station") || "";

  const session = stationId ? readSession(stationId) : null;

  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  async function runEvaluation() {
    if (!session) return;
    if (session.transcript.length < 2) {
      setError(new ApiError({
        message: "Transcript trop court pour être évalué.",
        code: "bad_request",
        status: 400,
        hint: "Relancez une simulation plus complète.",
      }));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await evaluate({ stationId: session.stationId, transcript: session.transcript });
      setResult(res);
    } catch (err) {
      const e = err as ApiError;
      setError(e);
      toast({
        title: "Évaluation impossible",
        description: `${e.message}${e.hint ? ` — ${e.hint}` : ""}`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void runEvaluation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Markdown nettoyé (sans SCORE GLOBAL ni LÉGENDE DES STATUTS) : mémoïsé pour
  // ne pas refaire le strip à chaque re-render.
  const cleanedMarkdown = useMemo(
    () => (result ? stripRedundantSections(result.markdown) : ""),
    [result],
  );

  // Icônes injectées en post-traitement sur les h2 : pour garder `AccentedMarkdown`
  // agnostique, on ajoute les icônes via un sélecteur post-rendu.
  // Plutôt que ce hack, on scanne les titres niveau 2 dans `cleanedMarkdown` et on
  // fait le rendu section par section en React pur — voir renderStructured() ci-dessous.

  async function handleExportPdf() {
    if (!result || !session) return;
    setIsExporting(true);
    try {
      const { pdf } = await import("@react-pdf/renderer");
      const blob = await pdf(
        <ReportPdf
          scores={result.scores}
          markdown={result.markdown}
          stationId={session.stationId}
          stationTitle=""
          generatedAt={new Date()}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const safeTitle = session.stationId.replace(/[^a-zA-Z0-9_-]/g, "");
      link.download = `OSCE_${safeTitle}_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Export PDF impossible",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  }

  if (!session) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Aucune session trouvée</h1>
        <p className="text-muted-foreground mb-6">
          Lancez une simulation sur une station avant d'accéder à l'évaluation.
        </p>
        <Button variant="outline" onClick={() => setLocation("/")}>
          <ArrowLeft className="w-5 h-5 mr-2" /> Bibliothèque
        </Button>
      </div>
    );
  }

  if (loading && !result) {
    return (
      <div className="p-8 max-w-5xl mx-auto flex flex-col items-center justify-center h-full text-center">
        <Loader2 className="w-12 h-12 animate-spin text-primary mb-6" />
        <h1 className="text-3xl font-bold mb-2">Analyse en cours</h1>
        <p className="text-muted-foreground text-lg">
          Claude Sonnet 4.5 relit le transcript et structure le rapport selon la grille officielle…
        </p>
      </div>
    );
  }

  if (error && !result) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Évaluation impossible</h1>
        <p className="text-red-700 mb-2">{error.message}</p>
        {error.hint && <p className="text-muted-foreground mb-6">{error.hint}</p>}
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setLocation("/")}>
            <ArrowLeft className="w-5 h-5 mr-2" /> Bibliothèque
          </Button>
          <Button onClick={runEvaluation} disabled={loading}>
            <RotateCcw className="w-5 h-5 mr-2" /> Réessayer
          </Button>
        </div>
      </div>
    );
  }

  if (!result) return null;

  const scores: EvaluationScores = result.scores;
  const globalTone = toneForScore(scores.globalScore);
  const gt = TONE_CLASSES[globalTone];

  return (
    <div className="p-8 max-w-5xl mx-auto animate-in fade-in duration-500 pb-24">
      <div className="flex justify-between items-center mb-8 no-print">
        <Button variant="ghost" onClick={() => setLocation("/")} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5 mr-2" /> Retour à la bibliothèque
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={runEvaluation} disabled={loading}>
            {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <RotateCcw className="w-5 h-5 mr-2" />}
            Réévaluer
          </Button>
          <Button onClick={handleExportPdf} disabled={isExporting} className="shadow-sm" data-testid="button-export-pdf">
            {isExporting ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Download className="w-5 h-5 mr-2" />}
            {isExporting ? "Génération…" : "Exporter en PDF"}
          </Button>
        </div>
      </div>

      {/* Synthèse : donut + barres par axe + verdict, colorés selon le score */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="md:col-span-2 border-border shadow-sm">
          <CardHeader className="bg-muted/30 pb-4 flex-row items-center justify-between">
            <CardTitle className="text-xl">Performance Globale</CardTitle>
            {result.stationType && (
              <span
                className="text-xs font-medium text-muted-foreground bg-background px-2 py-1 rounded-md border border-border"
                data-testid="eval-station-type"
                title="station_type inféré au chargement de la station (Phase 2)"
              >
                Type : {stationTypeLabel(result.stationType)}
              </span>
            )}
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex items-center gap-6">
              <div
                className={`flex-shrink-0 relative flex items-center justify-center w-32 h-32 rounded-full ${gt.bg} border-[8px] ${gt.ring}`}
                data-testid="score-global"
              >
                <span className={`text-4xl font-bold ${gt.text}`}>{scores.globalScore}%</span>
              </div>
              <div className="flex-1 space-y-4">
                {scores.sections.map((s) => {
                  const weightPct = Math.round(s.weight * 100);
                  const nonEvaluated = weightPct === 0;
                  return (
                    <div key={s.key} data-testid={`score-${s.key}`} className={nonEvaluated ? "opacity-60" : ""}>
                      <div className="flex justify-between text-sm mb-1 font-medium">
                        <span>
                          {s.name}
                          <span
                            className="text-muted-foreground ml-2 font-normal"
                            title={nonEvaluated ? "axe affiché mais non évalué sur ce type de station (poids 0)" : undefined}
                          >
                            (poids {weightPct}%{nonEvaluated ? " — non évalué" : ""})
                          </span>
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          {s.raw ? `${s.raw} · ${s.score}%` : `${s.score}%`}
                        </span>
                      </div>
                      <ScoreBar value={s.score} />
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={`border ${gt.border} ${gt.bg}`}>
          <CardHeader>
            <CardTitle className={`text-lg flex items-center ${gt.text}`}>
              <TrendingUp className="w-5 h-5 mr-2" /> Verdict
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-3xl font-bold mb-2 ${gt.text}`} data-testid="verdict">{scores.verdict}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {scores.globalScore}% — moyenne pondérée des axes évalués.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Rapport détaillé : Markdown nettoyé rendu avec accents + tableaux stylés.
          Les icônes de section sont placées à côté du contenu via une sur-couche
          qui cible le Markdown déjà rendu : plus simple, on ajoute un pictogramme
          inline en tête de chaque h2 détecté. */}
      <Card className="border-border shadow-sm">
        <CardHeader className="bg-muted/30">
          <CardTitle className="text-xl flex items-center">
            <FileText className="w-5 h-5 mr-2 text-primary" /> Rapport détaillé
          </CardTitle>
        </CardHeader>
        <CardContent className="py-6">
          <StructuredReport markdown={cleanedMarkdown} />
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────── Rendu du Markdown découpé par section h2 ───────────
// On découpe le texte nettoyé sur les titres niveau 2 pour pouvoir afficher une
// icône dédiée à côté de chaque section narrative sans alourdir AccentedMarkdown.
// Les sections qui ne sont pas des h2 (préambule, contenu sans titre) sont
// rendues telles quelles en tête de rapport.

interface Section {
  heading: string | null;
  body: string;
}

function splitByH2(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let current: Section = { heading: null, body: "" };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (current.heading !== null || current.body.trim() !== "") {
        sections.push(current);
      }
      current = { heading: m[1], body: "" };
    } else {
      current.body += (current.body ? "\n" : "") + line;
    }
  }
  if (current.heading !== null || current.body.trim() !== "") {
    sections.push(current);
  }
  return sections;
}

function StructuredReport({ markdown }: { markdown: string }) {
  const sections = useMemo(() => splitByH2(markdown), [markdown]);
  return (
    <div>
      {sections.map((s, i) => (
        <section key={i}>
          {s.heading !== null && (
            <h2 className="text-xl font-bold text-primary mt-8 mb-4 pb-2 border-b border-primary/20 uppercase tracking-wide flex items-center gap-2">
              {sectionIcon(s.heading)}
              <span>{s.heading}</span>
            </h2>
          )}
          {s.body.trim() !== "" && <AccentedMarkdown>{s.body}</AccentedMarkdown>}
        </section>
      ))}
    </div>
  );
}
