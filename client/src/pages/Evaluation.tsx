import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Download, ArrowLeft, TrendingUp, Loader2, RotateCcw, FileText,
  ClipboardList, Lightbulb, Layers, AlertTriangle,
} from "lucide-react";
import {
  ApiError, evaluate, evaluatePresentation, getEvaluationWeights,
  PRESENTATION_AXES,
  type EvaluationResult, type EvaluationScores,
  type EvaluationWeightsResponse, type PatientBrief, type PresentationAxis,
  type PresentationEvaluation, type StationType,
} from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ReportPdf } from "@/components/ReportPdf";
import { AccentedMarkdown } from "@/components/AccentedMarkdown";
import LegalDebriefPanel from "@/components/LegalDebriefPanel";
import { stripRedundantSections } from "@/lib/reportFormatting";
import {
  readPart1EvaluationRecord,
  type Part1EvaluationRecord,
} from "@/lib/part1Evaluation";

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

// Canonicals côté front : ordre d'affichage + libellés fallback des axes.
// Source de vérité des POIDS = `/api/evaluator/weights` (table Phase 2),
// non les weights renvoyés avec chaque section d'évaluation. Ça rend la
// page robuste à un serveur stale qui aurait omis une section (ex. Clôture
// absente de la sortie Sonnet) — on synthétise la rangée manquante avec
// score=0 et le poids canonique.
const CANONICAL_AXES = ["anamnese", "examen", "management", "cloture", "communication"] as const;
type CanonicalAxis = typeof CANONICAL_AXES[number];

const AXIS_LABELS: Record<CanonicalAxis, string> = {
  anamnese: "Anamnèse",
  examen: "Examen",
  management: "Management",
  cloture: "Clôture",
  communication: "Communication",
};

interface DisplaySection {
  key: CanonicalAxis;
  name: string;
  weight: number; // 0-1 (fraction)
  score: number;
  raw?: string;
}

// Phase 9 J4 — Q-A8 (validée user) : pondération du score combiné
// stations doubles. P1 (consultation patient, 9 min) prime sur P2
// (présentation orale, 4 min) au prorata (60/40), arrondi via Math.round.
const COMBINED_SCORE_WEIGHT_P1 = 0.6;
const COMBINED_SCORE_WEIGHT_P2 = 0.4;

export function combinedGlobalScore(scoreP1: number, scoreP2: number): number {
  return Math.round(COMBINED_SCORE_WEIGHT_P1 * scoreP1 + COMBINED_SCORE_WEIGHT_P2 * scoreP2);
}

// Libellés et ordre canonique des 4 axes presentation (Phase 8 J3).
// Source unique côté client pour les labels affichés (le serveur expose
// les axes via les clés `axes[axis]` du payload PresentationEvaluation
// avec scores normalisés 0..1).
const PRESENTATION_AXIS_LABELS: Record<PresentationAxis, string> = {
  presentation: "Présentation",
  raisonnement: "Raisonnement",
  examens: "Examens complémentaires",
  management: "Management",
};

// Fusion côté front : pour chaque axe canonique, on récupère le score depuis
// la sortie évaluateur (par key) ET le POIDS DYNAMIQUE depuis la même section
// (rééchelonné en mode 6-axes via getEffectiveAxisWeights côté backend, cf.
// Phase 7 J2). La table /api/evaluator/weights reste un fallback de robustesse
// pour les cas où une section canonique n'est pas présente dans `sections`
// (serveur stale, hallucination LLM omettant une rangée). L'ordre des rangées
// rendues est TOUJOURS CANONICAL_AXES, donc 5 rangées exactement —
// anamnèse > examen > management > clôture > communication.
//
// Phase 9 J4 — Bug 1 : inversion de priorité. Avant J4, la table statique
// (canonicalPercent, base v1 25/25/25/25/0 pour anamnese_examen) primait
// sur `existing.weight`, ce qui faisait que les stations à legalContext
// affichaient 25% côté HTML alors que le PDF (qui consomme `existing.weight`)
// affichait 23% (= 22.5 arrondi par Math.round). Maintenant : `existing.weight`
// (rééchelonné backend) est la source primaire ; canonicalPercent ne sert
// qu'aux axes absents de `sections`.
export function buildDisplaySections(
  sections: EvaluationScores["sections"],
  weightsTable: EvaluationWeightsResponse | null,
  stationType: StationType | undefined,
): DisplaySection[] {
  const byKey = new Map<string, EvaluationScores["sections"][number]>();
  for (const s of sections) byKey.set(s.key, s);
  const canonicalPercent = weightsTable && stationType ? weightsTable.weights[stationType] : null;
  return CANONICAL_AXES.map((axis) => {
    const existing = byKey.get(axis);
    const weightPct = existing
      ? Math.round(existing.weight * 100)
      : canonicalPercent
        ? canonicalPercent[axis]
        : 0;
    return {
      key: axis,
      name: existing?.name ?? AXIS_LABELS[axis],
      weight: weightPct / 100,
      score: existing?.score ?? 0,
      ...(existing?.raw ? { raw: existing.raw } : {}),
    };
  });
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

  // Phase 9 J4 — Q-A10/dette 7 : détection P2 (station double partie 2). Si
  // `brief.parentStationId` est défini, la page bascule sur le rendu bilan
  // combiné : appel /api/evaluation/presentation au lieu de /api/evaluator/evaluate
  // + lecture sessionStorage `osce.eval.${parentStationId}` pour le résultat P1.
  // Pour les 287 stations sans parent, isP2 reste false → flow strictement
  // identique au pré-J4 (rétrocompat byte-à-byte des tests existants).
  const parentStationId = session?.brief?.parentStationId;
  const isP2 = !!parentStationId;

  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [presentationResult, setPresentationResult] = useState<PresentationEvaluation | null>(null);
  // Q-A9 (validée) : pas de stockage P2 sessionStorage. P2 lu directement
  // depuis le résultat /api/evaluation/presentation (state React standard).
  // Seul P1 reste en sessionStorage `osce.eval.${parentStationId}`.
  const [p1Record, setP1Record] = useState<Part1EvaluationRecord | null>(null);
  const [weightsTable, setWeightsTable] = useState<EvaluationWeightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Table Phase 2 fetchée une fois au mount. Source de vérité des POIDS.
  // Le résultat d'évaluation transporte les scores ; les poids affichés
  // viennent d'ici, pas du payload évaluateur — garde-fou contre les
  // hallucinations de Sonnet et contre un serveur stale.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const w = await getEvaluationWeights();
        if (!cancelled) setWeightsTable(w);
      } catch {
        // Table non accessible (endpoint manquant ? serveur pré-Phase-2 ?)
        // On fonctionnera en mode dégradé — cf. buildDisplaySections qui
        // retombe sur les weights du payload évaluateur dans ce cas.
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
      if (isP2) {
        // Phase 9 J4 — flow stations doubles partie 2 (présentation orale).
        // Endpoint isolé /api/evaluation/presentation, scoring 4 axes 25 %
        // (presentation/raisonnement/examens/management) heuristique pure.
        // Le transcript est sérialisé en string (l'endpoint /presentation
        // attend un payload string, pas un tableau de tours, cf. Phase 8 J3).
        const transcriptString = session.transcript
          .map((t) => `[${t.role}] ${t.text}`)
          .join("\n");
        const pres = await evaluatePresentation({
          stationId: session.stationId,
          transcript: transcriptString,
        });
        // eslint-disable-next-line no-console
        console.info("[evaluation] received P2 presentation result:", {
          stationId: pres.stationId,
          parentStationId: pres.parentStationId,
          weightedScore: pres.weightedScore,
          axes: Object.keys(pres.axes),
        });
        setPresentationResult(pres);
        return;
      }
      const res = await evaluate({ stationId: session.stationId, transcript: session.transcript });
      // Instrumentation debug Phase 2 — loggue la shape brute que le front
      // reçoit. Utile au user pour diagnostiquer un serveur stale vs un
      // bug front. Apparaît dans la DevTools Console du navigateur.
      // eslint-disable-next-line no-console
      console.info("[evaluation] received result:", {
        stationType: res.stationType,
        communicationWeight: res.communicationWeight,
        sectionsCount: res.scores?.sections?.length,
        sectionKeys: res.scores?.sections?.map((s) => s.key),
        globalScore: res.scores?.globalScore,
      });
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

  // Phase 9 J4 — dette 7 : lecture du record P1 depuis sessionStorage. Une
  // seule fois au mount, uniquement quand la station courante est une P2
  // (parentStationId défini). En cas d'absence/JSON malformé/erreur P1,
  // readPart1EvaluationRecord retourne null → fallback dégradé géré côté
  // rendu (bandeau d'avertissement, P2 seule).
  useEffect(() => {
    if (!isP2 || !parentStationId) return;
    setP1Record(readPart1EvaluationRecord(parentStationId));
  }, [isP2, parentStationId]);

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

  // Phase 9 J4 — dette 7 : la condition de loader/erreur dépend du flow.
  // En mode P2, on attend `presentationResult` (et non `result`).
  const primaryResult = isP2 ? presentationResult : result;

  if (loading && !primaryResult) {
    return (
      <div className="p-8 max-w-5xl mx-auto flex flex-col items-center justify-center h-full text-center">
        <Loader2 className="w-12 h-12 animate-spin text-primary mb-6" />
        <h1 className="text-3xl font-bold mb-2">Analyse en cours</h1>
        <p className="text-muted-foreground text-lg">
          {isP2
            ? "Analyse heuristique de la présentation orale en cours…"
            : "Claude Sonnet 4.5 relit le transcript et structure le rapport selon la grille officielle…"}
        </p>
      </div>
    );
  }

  if (error && !primaryResult) {
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

  // Phase 9 J4 — dette 7 : branche de rendu P2 (bilan combiné). Émise AVANT
  // le rendu classique 5/6 axes pour éviter d'agréger deux comportements
  // dans un seul bloc JSX. Pour les 287 stations sans parentStationId,
  // cette branche est court-circuitée et le rendu legacy s'applique
  // strictement à l'identique (rétrocompat byte-à-byte des tests Phase 7).
  if (isP2 && presentationResult && parentStationId) {
    return (
      <CombinedEvaluationView
        session={session}
        parentStationId={parentStationId}
        presentationResult={presentationResult}
        p1Record={p1Record}
        weightsTable={weightsTable}
        loading={loading}
        onRetry={runEvaluation}
        onBack={() => setLocation("/")}
      />
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
                {/* Les 5 rangées canoniques sont TOUJOURS rendues, quelles que
                    soient les sections présentes dans `scores.sections`. Les
                    poids viennent de la table Phase 2 via /api/evaluator/weights
                    (source de vérité unique), pas du payload évaluateur. Ça
                    protège le rendu contre :
                      - un serveur stale qui n'aurait pas le weight override
                      - une hallucination Sonnet sur le weight par axe
                      - une section Clôture omise de la sortie LLM */}
                {buildDisplaySections(scores.sections, weightsTable, result.stationType).map((s) => {
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
                {/* Phase 7 J2/J4 — 6e axe Médico-légal, conditionnel.
                    Affiché UNIQUEMENT quand la station porte un legalContext
                    (i.e. result.medicoLegalScore et medicoLegalWeight définis
                    côté backend). Pour les ~282 stations sans legalContext,
                    cette ligne est absente du rendu — invariant de rétro-
                    compatibilité visuelle vs Phase 6 (5 axes uniquement).
                    Format identique aux 5 lignes du dessus pour cohérence
                    visuelle ; le drill-down sous-axes (reconnaissance /
                    verbalisation / décision / communication) reste dans le
                    LegalDebriefPanel Phase 5 plus bas, on n'écrase rien. */}
                {result.medicoLegalScore !== undefined && result.medicoLegalWeight !== undefined && (
                  <div data-testid="score-medico_legal">
                    <div className="flex justify-between text-sm mb-1 font-medium">
                      <span>
                        Médico-légal
                        <span className="text-muted-foreground ml-2 font-normal">
                          (poids {result.medicoLegalWeight}%)
                        </span>
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {result.medicoLegalScore}%
                      </span>
                    </div>
                    <ScoreBar value={result.medicoLegalScore} />
                  </div>
                )}
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

      {/* Phase 5 J4 — debrief médico-légal additif. Le composant fait son
          propre fetch /api/evaluation/legal et :
            • se cache silencieusement (return null) pour les ~285 stations
              sans legalContext (réponse 400 attendue),
            • s'affiche pour les 3 pilotes Phase 5 (AMBOSS-24, USMLE-34,
              RESCOS-72) avec score gradué par axe + décision attendue +
              recommandations pédagogiques.
          ZÉRO modification du scoring 5-axes Phase 2/3 : on consomme un
          endpoint isolé (POST /api/evaluation/legal). */}
      <LegalDebriefPanel
        stationId={session.stationId}
        transcript={session.transcript
          .map((t) => `[${t.role === "doctor" ? "Médecin" : "Patient"}] ${t.text}`)
          .join("\n")}
      />
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

// ────────────────────────────────────────────────────────────────────────
// Phase 9 J4 — dette 7 : rendu bilan combiné stations doubles (P1 + P2).
//
// Branche dédiée invoquée UNIQUEMENT pour les stations P2 (parentStationId
// défini dans le brief). Compose verticalement :
//   1. bandeau « Bilan combiné — Station double » (si P1 lu avec succès)
//   2. score global combiné = round(0.6 × scoreP1 + 0.4 × scoreP2) (Q-A8)
//   3. section P1 (5 axes + medico_legal optionnel) — si record P1 valide
//   4. section P2 (4 axes presentation 25 % chacun) — toujours
//   5. fallback dégradé si P1 absent/erreur (Q-J4-6) : bandeau warning,
//      pas de score combiné, section P2 seule, aucun crash.
//
// Pour les 287 stations sans parentStationId : ce composant n'est JAMAIS
// rendu (cf. condition `isP2 && presentationResult` côté Evaluation()).
// ────────────────────────────────────────────────────────────────────────

interface CombinedEvaluationViewProps {
  session: Session;
  parentStationId: string;
  presentationResult: PresentationEvaluation;
  p1Record: Part1EvaluationRecord | null;
  weightsTable: EvaluationWeightsResponse | null;
  loading: boolean;
  onRetry: () => void;
  onBack: () => void;
}

function CombinedEvaluationView({
  session,
  parentStationId,
  presentationResult,
  p1Record,
  weightsTable,
  loading,
  onRetry,
  onBack,
}: CombinedEvaluationViewProps) {
  const p1EvaluatorOk = !!p1Record?.evaluatorResult && !p1Record?.error;
  const p1EvaluatorResult = p1EvaluatorOk ? p1Record!.evaluatorResult! : null;

  const scoreP1 = p1EvaluatorResult?.scores.globalScore ?? null;
  const scoreP2 = Math.round(presentationResult.weightedScore);
  const combined =
    scoreP1 !== null ? combinedGlobalScore(scoreP1, scoreP2) : null;
  const combinedTone = combined !== null ? toneForScore(combined) : toneForScore(scoreP2);
  const ct = TONE_CLASSES[combinedTone];

  return (
    <div className="p-8 max-w-5xl mx-auto animate-in fade-in duration-500 pb-24">
      <div className="flex justify-between items-center mb-8 no-print">
        <Button variant="ghost" onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5 mr-2" /> Retour à la bibliothèque
        </Button>
        <Button variant="outline" onClick={onRetry} disabled={loading}>
          {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <RotateCcw className="w-5 h-5 mr-2" />}
          Réévaluer
        </Button>
      </div>

      {p1EvaluatorOk ? (
        <Card
          className={`border ${ct.border} ${ct.bg} mb-6`}
          data-testid="combined-banner"
        >
          <CardHeader className="pb-3">
            <CardTitle className={`text-base flex items-center ${ct.text}`}>
              <Layers className="w-5 h-5 mr-2" />
              Bilan combiné — Station double
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Récapitulatif des deux temps de la station :{" "}
              <span className="font-semibold">{parentStationId}</span> (consultation, 9 min) →{" "}
              <span className="font-semibold">{session.stationId}</span> (présentation orale, 4 min).
              Score combiné pondéré 60 % / 40 % proportionnellement à la durée.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card
          className="border border-amber-200 bg-amber-50 mb-6"
          data-testid="combined-warning"
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center text-amber-700">
              <AlertTriangle className="w-5 h-5 mr-2" />
              Évaluation Phase 1 indisponible — bilan partiel affiché
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-amber-900 leading-relaxed">
              Le résultat de la consultation initiale ({parentStationId}) n'a pas pu être récupéré ;
              seule la présentation orale ({session.stationId}) est notée ci-dessous. Le score
              global combiné n'est pas calculé.
            </p>
          </CardContent>
        </Card>
      )}

      {combined !== null && (
        <Card className="md:col-span-2 border-border shadow-sm mb-8" data-testid="combined-global-card">
          <CardHeader className="bg-muted/30 pb-4">
            <CardTitle className="text-xl">Performance globale combinée</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex items-center gap-6">
              <div
                className={`flex-shrink-0 relative flex items-center justify-center w-32 h-32 rounded-full ${ct.bg} border-[8px] ${ct.ring}`}
                data-testid="combined-score-global"
              >
                <span className={`text-4xl font-bold ${ct.text}`}>{combined}%</span>
              </div>
              <div className="flex-1 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Phase 1 (poids 60 %)</span>
                  <span className="tabular-nums font-medium" data-testid="combined-score-p1">{scoreP1}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Phase 2 (poids 40 %)</span>
                  <span className="tabular-nums font-medium" data-testid="combined-score-p2">{scoreP2}%</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {p1EvaluatorResult && (
        <Card className="border-border shadow-sm mb-8" data-testid="combined-section-p1">
          <CardHeader className="bg-muted/30">
            <CardTitle className="text-lg flex items-center">
              <ClipboardList className="w-5 h-5 mr-2 text-primary" />
              Phase 1 — Consultation ({parentStationId})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            {buildDisplaySections(
              p1EvaluatorResult.scores.sections,
              weightsTable,
              p1EvaluatorResult.stationType,
            ).map((s) => {
              const weightPct = Math.round(s.weight * 100);
              const nonEvaluated = weightPct === 0;
              return (
                <div
                  key={s.key}
                  data-testid={`p1-score-${s.key}`}
                  className={nonEvaluated ? "opacity-60" : ""}
                >
                  <div className="flex justify-between text-sm mb-1 font-medium">
                    <span>
                      {s.name}
                      <span className="text-muted-foreground ml-2 font-normal">
                        (poids {weightPct}%{nonEvaluated ? " — non évalué" : ""})
                      </span>
                    </span>
                    <span className="text-muted-foreground tabular-nums">{s.score}%</span>
                  </div>
                  <ScoreBar value={s.score} />
                </div>
              );
            })}
            {p1EvaluatorResult.medicoLegalScore !== undefined &&
              p1EvaluatorResult.medicoLegalWeight !== undefined && (
                <div data-testid="p1-score-medico_legal">
                  <div className="flex justify-between text-sm mb-1 font-medium">
                    <span>
                      Médico-légal
                      <span className="text-muted-foreground ml-2 font-normal">
                        (poids {p1EvaluatorResult.medicoLegalWeight}%)
                      </span>
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {p1EvaluatorResult.medicoLegalScore}%
                    </span>
                  </div>
                  <ScoreBar value={p1EvaluatorResult.medicoLegalScore} />
                </div>
              )}
            <p className="text-xs text-muted-foreground pt-2">
              Score Phase 1 :{" "}
              <span className="tabular-nums font-medium">{scoreP1}%</span>
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="border-border shadow-sm" data-testid="combined-section-p2">
        <CardHeader className="bg-muted/30">
          <CardTitle className="text-lg flex items-center">
            <FileText className="w-5 h-5 mr-2 text-primary" />
            Phase 2 — Présentation orale ({session.stationId})
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          {PRESENTATION_AXES.map((axis) => {
            const axisReport = presentationResult.axes[axis];
            const weightPct = Math.round((presentationResult.weights[axis] ?? 0) * 100);
            const axisScore = Math.round(axisReport.normalized * 100);
            return (
              <div key={axis} data-testid={`p2-score-${axis}`}>
                <div className="flex justify-between text-sm mb-1 font-medium">
                  <span>
                    {PRESENTATION_AXIS_LABELS[axis]}
                    <span className="text-muted-foreground ml-2 font-normal">
                      (poids {weightPct}%)
                    </span>
                  </span>
                  <span className="text-muted-foreground tabular-nums">{axisScore}%</span>
                </div>
                <ScoreBar value={axisScore} />
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground pt-2">
            Score Phase 2 :{" "}
            <span className="tabular-nums font-medium">{scoreP2}%</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
