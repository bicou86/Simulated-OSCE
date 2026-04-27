// Phase 4 J2 — tests du panneau « À qui parlez-vous ? ».
//
// On vérifie que :
//   • les boutons de sélection apparaissent pour chaque candidat,
//   • cliquer sur un bouton appelle onChoose avec le bon candidat,
//   • le bouton de fermeture appelle onDismiss,
//   • la raison fournie est affichée pour le diagnostic.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClarificationPanel } from "./ClarificationPanel";
import type { ClarificationCandidate } from "./ClarificationPanel";

const RESCOS_70_CANDIDATES: ClarificationCandidate[] = [
  { id: "emma", name: "Emma Delacroix", role: "patient" },
  { id: "mother", name: "Mère d'Emma Delacroix", role: "accompanying" },
];

afterEach(() => cleanup());

describe("ClarificationPanel", () => {
  it("renders one button per candidate", () => {
    render(
      <ClarificationPanel
        reason="multi-profil sans marqueur"
        candidates={RESCOS_70_CANDIDATES}
        onChoose={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId("clarification-panel")).toBeDefined();
    expect(screen.getByTestId("clarification-choose-emma")).toBeDefined();
    expect(screen.getByTestId("clarification-choose-mother")).toBeDefined();
  });

  it("displays the given reason", () => {
    render(
      <ClarificationPanel
        reason="multi-profil sans marqueur ni interlocuteur courant"
        candidates={RESCOS_70_CANDIDATES}
        onChoose={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/multi-profil sans marqueur/i)).toBeDefined();
  });

  it("calls onChoose with the right candidate when clicked", () => {
    const onChoose = vi.fn();
    render(
      <ClarificationPanel
        reason=""
        candidates={RESCOS_70_CANDIDATES}
        onChoose={onChoose}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("clarification-choose-mother"));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith({
      id: "mother",
      name: "Mère d'Emma Delacroix",
      role: "accompanying",
    });
  });

  it("calls onDismiss when the close button is clicked", () => {
    const onDismiss = vi.fn();
    render(
      <ClarificationPanel
        reason=""
        candidates={RESCOS_70_CANDIDATES}
        onChoose={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByLabelText(/fermer le panneau/i));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders role labels next to each candidate name", () => {
    render(
      <ClarificationPanel
        reason=""
        candidates={RESCOS_70_CANDIDATES}
        onChoose={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const emmaButton = screen.getByTestId("clarification-choose-emma");
    expect(emmaButton.textContent).toMatch(/Emma Delacroix/);
    expect(emmaButton.textContent).toMatch(/patient/i);
    const motherButton = screen.getByTestId("clarification-choose-mother");
    expect(motherButton.textContent).toMatch(/Mère d'Emma/);
    expect(motherButton.textContent).toMatch(/accompagnant/i);
  });
});
