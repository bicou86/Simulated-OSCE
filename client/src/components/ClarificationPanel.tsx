// Phase 4 J2 — panneau « À qui parlez-vous ? ».
//
// Affiché quand le routeur d'adresse côté serveur a tranché « ambigu »
// (multi-profils sans marqueur identifiable). L'utilisateur clique sur le
// bouton du participant cible : on insère un tag explicite « [À X] » au
// début de son message, on referme le panneau, et la requête est rejouée.
//
// Aucune logique LLM côté composant — pure UI déterministe.

import { Button } from "@/components/ui/button";
import { Users, X } from "lucide-react";
import type { ParticipantRoleClient } from "@/lib/api";

export interface ClarificationCandidate {
  id: string;
  name: string;
  role: ParticipantRoleClient;
}

interface ClarificationPanelProps {
  reason: string;
  candidates: ClarificationCandidate[];
  // Le candidat clique « Parler à X » : on lui rend l'id et le nom pour que
  // Simulation puisse insérer le tag « [À X] » dans le textarea et
  // dismiss le panneau.
  onChoose: (candidate: ClarificationCandidate) => void;
  // Fermer sans choisir (reformulation libre du candidat).
  onDismiss: () => void;
}

function roleLabel(role: ParticipantRoleClient): string {
  switch (role) {
    case "patient":
      return "patient·e";
    case "accompanying":
      return "accompagnant·e";
    case "witness":
      return "tiers";
  }
}

export function ClarificationPanel(props: ClarificationPanelProps) {
  const { reason, candidates, onChoose, onDismiss } = props;
  return (
    <div
      role="dialog"
      aria-label="À qui parlez-vous ?"
      data-testid="clarification-panel"
      className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <Users className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" aria-hidden />
        <div className="flex-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-amber-900">
              À qui parlez-vous ?
            </h3>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Fermer le panneau de clarification"
              className="text-amber-700 hover:text-amber-900"
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>
          <p className="mt-1 text-xs text-amber-800">
            Plusieurs interlocuteurs sont présents. Sélectionnez celui à qui
            vous adressez votre message — un tag <code>[À …]</code> sera
            ajouté en début de votre prochaine question. Vous pouvez aussi
            reformuler en nommant explicitement la personne.
          </p>
          {reason && (
            <p className="mt-1 text-[11px] italic text-amber-700/80">
              Raison&nbsp;: {reason}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {candidates.map((c) => (
              <Button
                key={c.id}
                type="button"
                size="sm"
                variant="secondary"
                data-testid={`clarification-choose-${c.id}`}
                onClick={() => onChoose(c)}
                className="bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300"
              >
                Parler à {c.name}{" "}
                <span className="ml-1 text-[10px] font-normal text-amber-700">
                  ({roleLabel(c.role)})
                </span>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
