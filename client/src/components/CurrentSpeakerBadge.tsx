// Phase 4 J4 — badge persistant en haut du chat affichant à qui le
// candidat parle actuellement. Mis à jour live à chaque event SSE
// `speaker` (avant le premier delta) ⇒ l'enseigné voit en temps réel le
// switch d'interlocuteur sans attendre la fin de la réponse.
//
// Visible UNIQUEMENT pour les stations multi-profils (≥ 2 participants).
// Sur les stations mono-patient legacy, le composant ne rend rien
// (rétrocompat 100 % — pas de pollution de l'UI historique).

import { cn } from "@/lib/utils";
import {
  participantAvatar,
  participantAccentClass,
} from "@/lib/preferences";
import type { ClientParticipant, PatientBrief } from "@/lib/api";

interface CurrentSpeakerBadgeProps {
  brief: PatientBrief | null | undefined;
  currentSpeakerId: string | null;
}

function findCurrentParticipant(
  brief: PatientBrief | null | undefined,
  currentSpeakerId: string | null,
): ClientParticipant | null {
  if (!brief?.participants || brief.participants.length < 2) return null;
  if (!currentSpeakerId) return brief.participants[0];
  return brief.participants.find((p) => p.id === currentSpeakerId) ?? brief.participants[0];
}

function roleLabel(role: ClientParticipant["role"]): string {
  switch (role) {
    case "patient":
      return "patient·e";
    case "accompanying":
      return "accompagnant·e";
    case "witness":
      return "tiers";
  }
}

export function CurrentSpeakerBadge({ brief, currentSpeakerId }: CurrentSpeakerBadgeProps) {
  const participant = findCurrentParticipant(brief, currentSpeakerId);
  // Hidden for mono-patient stations (≤ 1 participant).
  if (!participant) return null;
  const accent = participantAccentClass(participant.role);
  const avatar = participantAvatar(participant);
  const ageStr = typeof participant.age === "number" ? `, ${participant.age} ans` : "";
  return (
    <div
      data-testid="current-speaker-badge"
      data-speaker-id={participant.id}
      data-speaker-role={participant.role}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium",
        accent.badge,
      )}
      aria-live="polite"
    >
      <span aria-hidden className="text-lg leading-none">
        {avatar}
      </span>
      <span className="text-xs uppercase tracking-wider opacity-70">Vous parlez à</span>
      <span className="font-semibold">
        {participant.name}
        {ageStr}
      </span>
      <span className="text-[10px] uppercase opacity-60">({roleLabel(participant.role)})</span>
    </div>
  );
}
