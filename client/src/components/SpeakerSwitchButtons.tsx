// Phase 4 J4 — boutons rapides « Parler à X » + raccourci Tab pour
// alterner entre profils. Click ⇒ insère un préfixe `[À NAME] ` au début
// du textarea du candidat. Tab cycle entre les participants déclarés.
//
// Comme CurrentSpeakerBadge, ce composant ne rend rien sur les stations
// mono-patient (≤ 1 participant) ⇒ rétrocompat 100 %.

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  participantAvatar,
  participantAccentClass,
} from "@/lib/preferences";
import type { ClientParticipant, PatientBrief } from "@/lib/api";

interface SpeakerSwitchButtonsProps {
  brief: PatientBrief | null | undefined;
  currentSpeakerId: string | null;
  // Callback : reçoit le participant cliqué (ou cyclé via Tab). Le parent
  // (Simulation.tsx) insère « [À NAME] » dans le textarea et donne le
  // focus à l'input.
  onSwitch: (participant: ClientParticipant) => void;
  // Si désactivé (station inactive, etc.), les boutons sont disabled
  // mais restent visibles pour conserver la lisibilité du contrat UI.
  disabled?: boolean;
}

export function SpeakerSwitchButtons({
  brief,
  currentSpeakerId,
  onSwitch,
  disabled = false,
}: SpeakerSwitchButtonsProps) {
  const participants = brief?.participants ?? [];
  // Raccourci clavier : Tab (sans Shift, pas dans un input) cycle entre
  // les participants. Inactif si la station est mono ou si le user
  // tape dans un champ.
  useEffect(() => {
    if (participants.length < 2) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      // Ne pas voler le Tab quand le candidat tape dans le textarea ou
      // tout autre input éditable (focus accessible). On cycle UNIQUEMENT
      // depuis un focus en dehors d'un input éditable.
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (disabled) return;
      e.preventDefault();
      const idx = participants.findIndex((p) => p.id === currentSpeakerId);
      const nextIdx = (idx + 1 + participants.length) % participants.length;
      onSwitch(participants[nextIdx]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [participants, currentSpeakerId, onSwitch, disabled]);

  if (participants.length < 2) return null;

  return (
    <div
      data-testid="speaker-switch-buttons"
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Changer d'interlocuteur"
    >
      {participants.map((p) => {
        const isActive = p.id === currentSpeakerId;
        const accent = participantAccentClass(p.role);
        return (
          <Button
            key={p.id}
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            data-testid={`speaker-switch-${p.id}`}
            data-active={isActive}
            onClick={() => onSwitch(p)}
            className={cn(
              "gap-2 border",
              accent.badge,
              // Active = anneau accent visible pour confirmer qui parle
              // actuellement. Rester ergonomique : cliquable pour
              // confirmer / re-tagger même quand actif.
              isActive ? `ring-2 ${accent.ring}` : "opacity-80 hover:opacity-100",
            )}
            aria-pressed={isActive}
          >
            <span aria-hidden className="text-base leading-none">
              {participantAvatar(p)}
            </span>
            Parler à {p.name}
            {isActive && (
              <span className="text-[10px] uppercase opacity-70 ml-1">(actif)</span>
            )}
          </Button>
        );
      })}
    </div>
  );
}
