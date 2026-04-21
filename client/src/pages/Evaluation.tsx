import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Download, ArrowLeft, TrendingUp, Loader2, RotateCcw, FileText,
} from "lucide-react";
import {
  ApiError, evaluate, type EvaluationResult, type EvaluationScores, type PatientBrief,
} from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ReportPdf } from "@/components/ReportPdf";

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

  const scores = result.scores;
  const verdictTone =
    scores.verdict === "Réussi" ? { bg: "bg-primary/5", border: "border-primary/20", fg: "text-primary" } :
    scores.verdict === "À retravailler" ? { bg: "bg-amber-50", border: "border-amber-200", fg: "text-amber-700" } :
    { bg: "bg-red-50", border: "border-red-200", fg: "text-red-700" };

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

      {/* Scores + verdict */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="md:col-span-2 border-border shadow-sm">
          <CardHeader className="bg-muted/30 pb-4">
            <CardTitle className="text-xl">Performance Globale</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex items-center gap-6">
              <div className="flex-shrink-0 relative flex items-center justify-center w-32 h-32 rounded-full bg-primary/5 border-[8px] border-primary/20" data-testid="score-global">
                <span className="text-4xl font-bold text-primary">{scores.globalScore}%</span>
              </div>
              <div className="flex-1 space-y-4">
                {scores.sections.map((s) => (
                  <div key={s.key} data-testid={`score-${s.key}`}>
                    <div className="flex justify-between text-sm mb-1 font-medium">
                      <span>
                        {s.name}
                        <span className="text-muted-foreground ml-2 font-normal">
                          (poids {(s.weight * 100).toFixed(0)}%)
                        </span>
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {s.raw ? `${s.raw} · ${s.score}%` : `${s.score}%`}
                      </span>
                    </div>
                    <Progress value={s.score} className="h-2" />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={`border ${verdictTone.border} ${verdictTone.bg}`}>
          <CardHeader>
            <CardTitle className={`text-lg flex items-center ${verdictTone.fg}`}>
              <TrendingUp className="w-5 h-5 mr-2" /> Verdict
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-3xl font-bold mb-2 ${verdictTone.fg}`} data-testid="verdict">{scores.verdict}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {scores.globalScore}% — moyenne pondérée des axes évalués.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Rapport détaillé en markdown */}
      <Card className="border-border shadow-sm">
        <CardHeader className="bg-muted/30">
          <CardTitle className="text-xl flex items-center">
            <FileText className="w-5 h-5 mr-2 text-primary" /> Rapport détaillé
          </CardTitle>
        </CardHeader>
        <CardContent className="py-6">
          <div className="prose-osce">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.markdown}</ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
