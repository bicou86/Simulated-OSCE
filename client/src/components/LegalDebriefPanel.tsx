// Phase 5 J4 — Panel de debrief médico-légal pour la page Evaluation.
//
// Affiché EN COMPLÉMENT (pas en remplacement) du scoring 5-axes Phase 2/3,
// uniquement quand la station porte un `legalContext`. Pour les ~285 stations
// sans qualification médico-légale, l'endpoint /api/evaluation/legal répond
// 400 et le panel ne se rend pas (silencieux : pas d'erreur affichée à
// l'utilisateur).
//
// Architecture (option client) :
//   • le panel fait son propre fetch → /api/evaluation/legal en parallèle
//     de l'évaluation Phase 2/3 (Sonnet) lancée par la page parente.
//   • zéro appel LLM côté serveur → réponse instantanée (regex/lexique
//     déterministe).
//   • zéro modification de l'endpoint /api/evaluator/evaluate (Phase 2/3
//     intouché par J4 — invariant J4 #1).

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Scale,
  CheckCircle2,
  Circle,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  ApiError,
  evaluateLegal,
  type LegalAxisKey,
  type LegalAxisReport,
  type LegalEvaluation,
} from "@/lib/api";

interface Props {
  stationId: string;
  // Transcription concaténée (concat des messages role/text de la session).
  transcript: string;
}

// Ordre canonique d'affichage des 4 axes.
const AXIS_ORDER: readonly LegalAxisKey[] = [
  "reconnaissance",
  "verbalisation",
  "decision",
  "communication",
] as const;

const AXIS_LABEL: Record<LegalAxisKey, string> = {
  reconnaissance: "Reconnaissance",
  verbalisation: "Verbalisation",
  decision: "Décision",
  communication: "Communication",
};

// Palette identique à celle de la page Evaluation (toneForScore Phase 2)
// pour la cohérence visuelle. ≥ 80 vert (excellent), 50–79 orange (à
// affiner), < 50 rouge (à retravailler).
type Tone = "green" | "amber" | "red";
function legalTone(score: number): Tone {
  if (score >= 80) return "green";
  if (score >= 50) return "amber";
  return "red";
}
const TONE_BG: Record<Tone, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};
const TONE_TEXT: Record<Tone, string> = {
  green: "text-emerald-700",
  amber: "text-amber-700",
  red: "text-red-700",
};

// Décision attendue → libellé patient + couleur de badge.
const DECISION_LABEL: Record<LegalEvaluation["expected_decision"], string> = {
  report: "Signaler à l'autorité",
  no_report: "Ne pas signaler",
  defer: "Différer la décision",
  refer: "Orienter (LAVI / spécialiste)",
  decline_certificate: "Refuser le certificat",
};
const DECISION_TONE: Record<LegalEvaluation["expected_decision"], Tone> = {
  report: "red",
  no_report: "green",
  defer: "amber",
  refer: "amber",
  decline_certificate: "red",
};

// Catégorie médico-légale → libellé humain.
const CATEGORY_LABEL: Record<string, string> = {
  signalement_maltraitance: "Signalement de maltraitance",
  signalement_danger_tiers: "Signalement de danger pour un tiers",
  secret_pro_levee: "Levée du secret professionnel",
  certificat_complaisance: "Refus de certificat de complaisance",
  declaration_obligatoire: "Déclaration obligatoire",
};

function ScoreBar({ value, tone }: { value: number; tone: Tone }) {
  const safe = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full ${TONE_BG[tone]} transition-all`}
        style={{ width: `${safe}%` }}
        aria-hidden
      />
    </div>
  );
}

function GradeIcon({ grade, isAntiPattern }: { grade: number; isAntiPattern: boolean }) {
  if (isAntiPattern) {
    return grade < 0 ? (
      <AlertTriangle
        className="w-4 h-4 text-red-600 flex-shrink-0"
        aria-label="anti-pattern détecté"
      />
    ) : (
      <Circle
        className="w-4 h-4 text-muted-foreground flex-shrink-0"
        aria-label="anti-pattern absent"
      />
    );
  }
  if (grade === 2) {
    return (
      <CheckCircle2
        className="w-4 h-4 text-emerald-600 flex-shrink-0"
        aria-label="concept clairement invoqué"
      />
    );
  }
  if (grade === 1) {
    return (
      <Circle
        className="w-4 h-4 text-amber-600 flex-shrink-0 fill-amber-100"
        aria-label="concept partiellement invoqué"
      />
    );
  }
  return (
    <XCircle
      className="w-4 h-4 text-red-600 flex-shrink-0"
      aria-label="concept absent"
    />
  );
}

function AxisCard({ axis }: { axis: LegalAxisReport }) {
  const tone = legalTone(axis.score_pct);
  return (
    <div className="border rounded-lg p-4" data-testid={`legal-axis-${axis.axis}`}>
      <div className="flex justify-between items-baseline mb-2">
        <h3 className={`text-sm font-semibold ${TONE_TEXT[tone]}`}>
          {AXIS_LABEL[axis.axis]}
        </h3>
        <span className={`text-sm font-bold tabular-nums ${TONE_TEXT[tone]}`}>
          {axis.score_pct}%
        </span>
      </div>
      <ScoreBar value={axis.score_pct} tone={tone} />
      {axis.items.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {axis.items.map((it, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-sm leading-tight"
              data-testid={`legal-item-${axis.axis}-${i}`}
            >
              <GradeIcon grade={it.grade} isAntiPattern={it.isAntiPattern} />
              <span className={it.isAntiPattern ? "text-muted-foreground" : ""}>
                {it.isAntiPattern ? "À éviter : " : ""}
                {it.text}
                {it.matchedPatterns > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">
                    ({it.matchedPatterns} match{it.matchedPatterns > 1 ? "es" : ""})
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LegalDebriefPanel({ stationId, transcript }: Props) {
  const [data, setData] = useState<LegalEvaluation | null>(null);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setHidden(false);
    (async () => {
      try {
        const res = await evaluateLegal({ stationId, transcript });
        if (!cancelled) setData(res);
      } catch (err) {
        const e = err as ApiError;
        if (cancelled) return;
        // 400 + mention de legalContext = station sans qualification
        // médico-légale → on cache simplement le panel (silencieux). Tout
        // autre code = vraie erreur, on affiche un message minimal.
        if (
          e.status === 400 &&
          (e.code === "bad_request" || /legalContext/i.test(e.message))
        ) {
          setHidden(true);
        } else {
          setError(`${e.message}${e.hint ? ` — ${e.hint}` : ""}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stationId, transcript]);

  if (hidden) return null;

  if (loading) {
    return (
      <Card className="border-border shadow-sm mt-6" data-testid="legal-debrief-loading">
        <CardHeader className="bg-muted/30">
          <CardTitle className="text-xl flex items-center">
            <Scale className="w-5 h-5 mr-2 text-primary" /> Cadre médico-légal
          </CardTitle>
        </CardHeader>
        <CardContent className="py-6 flex items-center gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          Analyse du cadre médico-légal…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-amber-200 shadow-sm mt-6" data-testid="legal-debrief-error">
        <CardHeader className="bg-amber-50">
          <CardTitle className="text-xl flex items-center text-amber-800">
            <Scale className="w-5 h-5 mr-2" /> Cadre médico-légal — indisponible
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-sm text-muted-foreground">{error}</CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const decisionTone = DECISION_TONE[data.expected_decision];
  const categoryLabel = CATEGORY_LABEL[data.category] ?? data.category;
  const reportingLabel = data.mandatory_reporting
    ? "Devoir d'aviser (signalement obligatoire)"
    : "Droit d'aviser (signalement non obligatoire)";

  return (
    <Card
      className="border-border shadow-sm mt-6"
      data-testid="legal-debrief-panel"
      aria-labelledby="legal-debrief-title"
    >
      <CardHeader className="bg-muted/30">
        <CardTitle
          id="legal-debrief-title"
          className="text-xl flex items-center gap-2"
        >
          <Scale className="w-5 h-5 text-primary" /> Cadre médico-légal
          <span className="text-xs font-normal text-muted-foreground ml-2">
            (analyse déterministe — lexique v{data.lexiconVersion})
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="py-6 space-y-6">
        {/* Bandeau résumé : catégorie + décision attendue + statut de signalement + cadre légal applicable. */}
        <div className="flex flex-wrap items-center gap-2" data-testid="legal-summary">
          <Badge
            variant="outline"
            className="text-sm py-1 px-3"
            data-testid="legal-category-badge"
          >
            {categoryLabel}
          </Badge>
          <Badge
            className={`text-sm py-1 px-3 ${
              decisionTone === "red"
                ? "bg-red-100 text-red-800 border-red-200 hover:bg-red-100"
                : decisionTone === "amber"
                  ? "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100"
                  : "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
            }`}
            data-testid="legal-decision-badge"
            aria-label={`Décision attendue : ${DECISION_LABEL[data.expected_decision]}`}
          >
            Décision attendue : {DECISION_LABEL[data.expected_decision]}
          </Badge>
          <Badge
            variant={data.mandatory_reporting ? "destructive" : "secondary"}
            className="text-sm py-1 px-3"
            data-testid="legal-reporting-badge"
            aria-label={reportingLabel}
          >
            {data.mandatory_reporting ? "Devoir d'aviser" : "Droit d'aviser"}
          </Badge>
        </div>

        {/* Grille des 4 axes. */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
          data-testid="legal-axes"
        >
          {AXIS_ORDER.map((k) => (
            <AxisCard key={k} axis={data.axes[k]} />
          ))}
        </div>

        {/* Recommandations pédagogiques : missing + avoided.
            On affiche cette section seulement si l'une des deux liste a au
            moins un élément — sinon le candidat a couvert tous les concepts
            sans déclencher d'anti-pattern, pas besoin de bruit visuel. */}
        {(data.missing.length > 0 || data.avoided.length > 0) && (
          <div className="border-t pt-4 space-y-3" data-testid="legal-recommendations">
            <h3 className="text-sm font-semibold">Recommandations pédagogiques</h3>
            {data.missing.length > 0 && (
              <div data-testid="legal-missing">
                <h4 className="text-xs font-medium text-amber-800 mb-1.5 flex items-center gap-1">
                  <Circle className="w-3 h-3" />
                  À verbaliser la prochaine fois ({data.missing.length}) :
                </h4>
                <ul className="text-sm space-y-1 ml-4 list-disc text-muted-foreground">
                  {data.missing.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            {data.avoided.length > 0 && (
              <div data-testid="legal-avoided">
                <h4 className="text-xs font-medium text-red-800 mb-1.5 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Anti-patterns détectés ({data.avoided.length}) :
                </h4>
                <ul className="text-sm space-y-1 ml-4 list-disc text-muted-foreground">
                  {data.avoided.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
