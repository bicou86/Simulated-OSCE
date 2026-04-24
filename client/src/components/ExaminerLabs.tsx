// Rendu des résultats de laboratoire dans la bulle examinateur (Phase 3 J2).
// Affiche un tableau par lab (colonnes : Paramètre / Valeur / Unité / Normes /
// Flag). Flag couleur :
//   - normal   = texte neutre (pas de surbrillance) ;
//   - low/high = fond ambre (hors normes mais pas critique) ;
//   - critical = fond rouge (seuil critique dépassé).
//
// Pas de zoom Radix Dialog — le texte est déjà lisible, pas besoin. La colonne
// "Normes" indique la source (adulte vs pédiatrique) pour la traçabilité
// pédagogique quand la valeur est interprétée sur une plage d'âge.

import { cn } from "@/lib/utils";
import type { LabFlag, LabsLookupResolvedResult } from "@/lib/api";

interface ExaminerLabsProps {
  results: LabsLookupResolvedResult[];
  className?: string;
}

function flagClasses(flag: LabFlag): string {
  switch (flag) {
    case "critical":
      return "bg-red-100 text-red-900 font-semibold border-red-300";
    case "low":
    case "high":
      return "bg-amber-100 text-amber-900 font-medium border-amber-300";
    case "normal":
    default:
      return "bg-transparent text-slate-800";
  }
}

function flagLabel(flag: LabFlag): string {
  switch (flag) {
    case "critical":
      return "CRITIQUE";
    case "low":
      return "bas";
    case "high":
      return "élevé";
    case "normal":
    default:
      return "normal";
  }
}

function formatRange(range: { min: number; max: number; source: "adult" | "pediatric" }): string {
  const base = `${range.min}–${range.max}`;
  return range.source === "pediatric" ? `${base} (péd.)` : base;
}

export function ExaminerLabs({ results, className }: ExaminerLabsProps) {
  if (results.length === 0) return null;
  return (
    <div className={cn("space-y-4", className)} data-testid="examiner-labs">
      {results.map((lab) => (
        <div
          key={lab.key}
          className="rounded-lg border border-slate-300 bg-white overflow-hidden"
          data-testid={`examiner-labs-table-${lab.key}`}
        >
          <div className="bg-slate-100 border-b border-slate-300 px-3 py-2 text-sm font-semibold not-italic text-slate-800">
            {lab.label}
          </div>
          <table className="w-full text-sm not-italic">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-medium px-3 py-1.5 w-[35%]">Paramètre</th>
                <th className="text-right font-medium px-3 py-1.5 w-[15%]">Valeur</th>
                <th className="text-left font-medium px-3 py-1.5 w-[15%]">Unité</th>
                <th className="text-left font-medium px-3 py-1.5 w-[20%]">Normes</th>
                <th className="text-left font-medium px-3 py-1.5 w-[15%]">Flag</th>
              </tr>
            </thead>
            <tbody>
              {lab.parameters.map((p) => (
                <tr
                  key={p.key}
                  className={cn(
                    "border-t border-slate-200",
                    p.flag === "critical" && "bg-red-50",
                    (p.flag === "low" || p.flag === "high") && "bg-amber-50",
                  )}
                  data-testid={`examiner-labs-row-${lab.key}-${p.key}`}
                  data-flag={p.flag}
                >
                  <td className="px-3 py-1.5 text-slate-800">
                    {p.label}
                    {p.note && (
                      <span className="block text-[11px] text-slate-500 italic mt-0.5">
                        {p.note}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-900">
                    {typeof p.value === "number" ? p.value : p.value}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">{p.unit || "—"}</td>
                  <td className="px-3 py-1.5 text-slate-600 font-mono text-xs">
                    {formatRange(p.normalRange)}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={cn(
                        "inline-block rounded border px-2 py-0.5 text-xs uppercase tracking-wide",
                        flagClasses(p.flag),
                      )}
                    >
                      {flagLabel(p.flag)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lab.interpretation && (
            <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs italic text-slate-700">
              <span className="font-semibold not-italic">Interprétation :</span>{" "}
              {lab.interpretation}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
