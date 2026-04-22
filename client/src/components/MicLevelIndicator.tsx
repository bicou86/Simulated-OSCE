// Indicateur visuel de niveau micro en mode conversation.
// 5 barres verticales qui réagissent au niveau RMS lissé, avec des couleurs
// différentes selon l'état :
//   - off       : pas d'animation (bouton normal, via un retour null côté consommateur)
//   - listening : barres grises pâles, hauteur minimale (écoute en attente)
//   - voice     : barres bleues, hauteur proportionnelle au level
//   - suspended : barres grises + pastille rouge clignotante, pas d'animation de level
//
// La courbe de hauteur par barre (offsets centraux plus hauts que latéraux) simule un
// effet d'onde naturel. Chaque barre est une simple div avec transform: scaleY() — GPU-
// friendly, aucune lib externe.

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { ConversationState } from "@/hooks/useConversationMode";

export interface MicLevelIndicatorProps {
  state: ConversationState;
  level: number; // 0..1
  barCount?: number;
  className?: string;
}

// Pondération par barre pour l'effet d'onde : les barres centrales répondent davantage.
// Valeurs normalisées — maxScale = 1 pour la barre centrale, ~0.45 pour les latérales.
export function barWeights(count: number): number[] {
  const out: number[] = [];
  const center = (count - 1) / 2;
  for (let i = 0; i < count; i++) {
    const d = Math.abs(i - center) / Math.max(1, center);
    // 0.45 en bord, 1.0 au centre (fonction quadratique douce)
    out.push(0.45 + 0.55 * (1 - d * d));
  }
  return out;
}

// Transforme un level [0..1] et une pondération en une hauteur scale-y [minScale..1].
// En `listening` : hauteur basse (~10%). En `voice` : de 20% à 100% selon level×weight.
export function scaleForBar(level: number, weight: number, state: ConversationState): number {
  if (state === "off") return 0.1;
  if (state === "suspended") return 0.12;
  if (state === "listening") return 0.1 + 0.05 * weight;
  // voice
  const base = 0.18;
  return Math.min(1, base + (1 - base) * Math.max(0, Math.min(1, level)) * weight);
}

const STATE_LABELS: Record<ConversationState, string> = {
  off: "Mode conversation inactif",
  listening: "Micro en écoute",
  voice: "Voix détectée",
  suspended: "Micro suspendu pendant la réponse du patient",
};

export function MicLevelIndicator({
  state,
  level,
  barCount = 5,
  className,
}: MicLevelIndicatorProps) {
  const weights = useMemo(() => barWeights(barCount), [barCount]);

  const barColor =
    state === "voice" ? "bg-primary" :
    state === "suspended" ? "bg-muted-foreground/40" :
    "bg-muted-foreground/30";

  return (
    <div
      className={cn("flex items-center justify-center gap-1 h-8 px-1 relative", className)}
      aria-live="polite"
      aria-label={STATE_LABELS[state]}
      data-testid="mic-level-indicator"
      data-state={state}
    >
      {state === "suspended" && (
        <span
          className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 animate-pulse"
          aria-hidden
        />
      )}
      {weights.map((w, i) => {
        const s = scaleForBar(level, w, state);
        return (
          <span
            key={i}
            className={cn("w-1 h-full rounded-full origin-bottom transition-transform", barColor)}
            style={{ transform: `scaleY(${s})`, transitionDuration: "60ms" }}
            aria-hidden
          />
        );
      })}
      <span className="sr-only">{STATE_LABELS[state]}</span>
    </div>
  );
}
