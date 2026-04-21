import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { MOCK_STATIONS, type Station } from "@/lib/mockData";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Printer, ArrowLeft, CheckCircle2, XCircle, AlertTriangle, TrendingUp, Loader2, RotateCcw } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ApiError, evaluate, type EvaluationReport } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type Session = {
  station: Station;
  transcript: Array<{ role: "patient" | "doctor"; text: string }>;
};

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

  const fallbackStation = MOCK_STATIONS.find((s) => s.id === stationId);
  const session = stationId ? readSession(stationId) : null;
  const station = session?.station ?? fallbackStation;

  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function runEvaluation() {
    if (!session || !station) return;
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
      const res = await evaluate({
        station: {
          scenario: station.scenario,
          title: station.title,
          specialty: station.specialty,
        },
        transcript: session.transcript,
      });
      setReport(res);
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

  const handlePrint = () => window.print();

  if (!station) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Station inconnue</h1>
        <p className="text-muted-foreground mb-6">Aucune station ne correspond à cet identifiant.</p>
        <Button onClick={() => setLocation("/")}>
          <ArrowLeft className="w-5 h-5 mr-2" /> Retour à la bibliothèque
        </Button>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Aucune session trouvée</h1>
        <p className="text-muted-foreground mb-6">
          Lancez la simulation <strong>{station.title}</strong> avant de demander une évaluation.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setLocation("/")}>
            <ArrowLeft className="w-5 h-5 mr-2" /> Bibliothèque
          </Button>
          <Button onClick={() => setLocation(`/simulation?station=${station.id}`)}>
            Lancer la simulation
          </Button>
        </div>
      </div>
    );
  }

  if (loading && !report) {
    return (
      <div className="p-8 max-w-5xl mx-auto flex flex-col items-center justify-center h-full text-center">
        <Loader2 className="w-12 h-12 animate-spin text-primary mb-6" />
        <h1 className="text-3xl font-bold mb-2">Analyse en cours</h1>
        <p className="text-muted-foreground text-lg">Claude Sonnet 4.5 relit le transcript et structure son rapport…</p>
      </div>
    );
  }

  if (error && !report) {
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

  if (!report) return null;

  const sections = [
    { name: "Anamnèse", score: report.anamnese },
    { name: "Examen Clinique", score: report.examen },
    { name: "Communication", score: report.communication },
    { name: "Diagnostic & Prise en charge", score: report.diagnostic },
  ];

  const verdictTone =
    report.verdict === "Réussi" ? { bg: "bg-primary/5", border: "border-primary/20", fg: "text-primary" } :
    report.verdict === "À retravailler" ? { bg: "bg-amber-50", border: "border-amber-200", fg: "text-amber-700" } :
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
          <Button onClick={handlePrint} className="shadow-sm">
            <Printer className="w-5 h-5 mr-2" /> Imprimer
          </Button>
        </div>
      </div>

      <div className="print-only mb-8 text-center hidden">
        <h1 className="text-3xl font-bold">Rapport d'Évaluation OSCE</h1>
        <p className="text-muted-foreground mt-2">Station : {station.title} ({station.source})</p>
        <Separator className="mt-4" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="md:col-span-2 border-border shadow-sm">
          <CardHeader className="bg-muted/30 pb-4">
            <CardTitle className="text-xl">Performance Globale</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex items-center gap-6">
              <div className="flex-shrink-0 relative flex items-center justify-center w-32 h-32 rounded-full bg-primary/5 border-[8px] border-primary/20" data-testid="score-global">
                <span className="text-4xl font-bold text-primary">{report.globalScore}%</span>
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="8" className="text-primary" strokeDasharray="289" strokeDashoffset={289 - (289 * report.globalScore) / 100} />
                </svg>
              </div>
              <div className="flex-1 space-y-4">
                {sections.map((s) => (
                  <div key={s.name} data-testid={`score-${s.name}`}>
                    <div className="flex justify-between text-sm mb-1 font-medium">
                      <span>{s.name}</span>
                      <span className="text-muted-foreground">{s.score}%</span>
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
            <p className={`text-3xl font-bold mb-2 ${verdictTone.fg}`} data-testid="verdict">{report.verdict}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Score global : <strong>{report.globalScore}%</strong> sur les 4 axes pondérés.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-green-200 bg-green-50/30">
          <CardHeader>
            <CardTitle className="text-lg flex items-center text-green-700">
              <CheckCircle2 className="w-5 h-5 mr-2" /> Points Forts
            </CardTitle>
          </CardHeader>
          <CardContent>
            {report.strengths.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Aucun point fort identifié.</p>
            ) : (
              <ul className="space-y-3">
                {report.strengths.map((item, idx) => (
                  <li key={idx} className="flex items-start">
                    <span className="text-green-500 mr-2 mt-0.5">•</span>
                    <span className="text-green-900/80">{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-red-200 bg-red-50/30">
          <CardHeader>
            <CardTitle className="text-lg flex items-center text-red-700">
              <XCircle className="w-5 h-5 mr-2" /> Omissions Critiques
            </CardTitle>
          </CardHeader>
          <CardContent>
            {report.criticalOmissions.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Aucune omission critique.</p>
            ) : (
              <ul className="space-y-3">
                {report.criticalOmissions.map((item, idx) => (
                  <li key={idx} className="flex items-start">
                    <span className="text-red-500 mr-2 mt-0.5">•</span>
                    <span className="text-red-900/80 font-medium">{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2 border-amber-200 bg-amber-50/30">
          <CardHeader>
            <CardTitle className="text-lg flex items-center text-amber-700">
              <AlertTriangle className="w-5 h-5 mr-2" /> Priorités d'Amélioration
            </CardTitle>
          </CardHeader>
          <CardContent>
            {report.priorities.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Aucune priorité identifiée.</p>
            ) : (
              <ul className="space-y-3">
                {report.priorities.map((item, idx) => (
                  <li key={idx} className="flex items-start">
                    <span className="text-amber-500 mr-2 mt-0.5">•</span>
                    <span className="text-amber-900/80">{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
