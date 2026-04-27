// Phase 4 J4 — tests des boutons rapides « Parler à X » + raccourci Tab.
//
// Couvre :
//   • visibilité conditionnelle (mono-patient ⇒ rien rendu),
//   • un bouton par participant déclaré,
//   • click ⇒ onSwitch reçoit le bon participant,
//   • bouton actif marqué (data-active + aria-pressed),
//   • raccourci Tab cycle entre participants quand le focus n'est pas
//     dans un input éditable.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SpeakerSwitchButtons } from "./SpeakerSwitchButtons";
import type { PatientBrief } from "@/lib/api";

afterEach(() => cleanup());

const RESCOS_70_BRIEF = {
  stationId: "RESCOS-70",
  setting: "Cabinet",
  patientDescription: "",
  vitals: {},
  phraseOuverture: "",
  sex: "female",
  age: 16,
  interlocutor: { type: "self", reason: "test" },
  participants: [
    { id: "emma", role: "patient", name: "Emma Delacroix", age: 16, vocabulary: "lay", knowledgeScope: ["a"] },
    { id: "mother", role: "accompanying", name: "Mère d'Emma Delacroix", vocabulary: "lay", knowledgeScope: ["b"] },
  ],
  defaultSpeakerId: "emma",
} as unknown as PatientBrief;

const MONO_BRIEF = {
  stationId: "RESCOS-1",
  setting: "Cabinet",
  patientDescription: "",
  vitals: {},
  phraseOuverture: "",
  sex: "female",
  age: 47,
  interlocutor: { type: "self", reason: "adult" },
} as unknown as PatientBrief;

describe("SpeakerSwitchButtons", () => {
  it("renders nothing for a mono-patient station", () => {
    const { container } = render(
      <SpeakerSwitchButtons brief={MONO_BRIEF} currentSpeakerId="patient" onSwitch={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one button per participant on a multi-profile brief", () => {
    render(
      <SpeakerSwitchButtons brief={RESCOS_70_BRIEF} currentSpeakerId="emma" onSwitch={vi.fn()} />,
    );
    expect(screen.getByTestId("speaker-switch-emma")).toBeDefined();
    expect(screen.getByTestId("speaker-switch-mother")).toBeDefined();
    expect(screen.getByTestId("speaker-switch-emma").textContent).toMatch(/Emma Delacroix/);
  });

  it("click on a button calls onSwitch with the right participant", () => {
    const onSwitch = vi.fn();
    render(
      <SpeakerSwitchButtons brief={RESCOS_70_BRIEF} currentSpeakerId="emma" onSwitch={onSwitch} />,
    );
    fireEvent.click(screen.getByTestId("speaker-switch-mother"));
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mother", role: "accompanying" }),
    );
  });

  it("active speaker button is marked data-active='true' + aria-pressed", () => {
    render(
      <SpeakerSwitchButtons brief={RESCOS_70_BRIEF} currentSpeakerId="mother" onSwitch={vi.fn()} />,
    );
    const motherBtn = screen.getByTestId("speaker-switch-mother");
    const emmaBtn = screen.getByTestId("speaker-switch-emma");
    expect(motherBtn.dataset.active).toBe("true");
    expect(motherBtn.getAttribute("aria-pressed")).toBe("true");
    expect(emmaBtn.dataset.active).toBe("false");
    expect(emmaBtn.getAttribute("aria-pressed")).toBe("false");
    // Mention « (actif) » présent dans le bouton actif.
    expect(motherBtn.textContent).toMatch(/actif/i);
  });

  it("Tab keyboard shortcut cycles to the next participant when focus is OUTSIDE an input", () => {
    const onSwitch = vi.fn();
    render(
      <SpeakerSwitchButtons brief={RESCOS_70_BRIEF} currentSpeakerId="emma" onSwitch={onSwitch} />,
    );
    // Focus sur document.body (pas un input).
    document.body.focus();
    const evt = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    document.body.dispatchEvent(evt);
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith(expect.objectContaining({ id: "mother" }));
  });

  it("Tab dans un <input> ne cycle PAS (préserve la navigation du formulaire)", () => {
    const onSwitch = vi.fn();
    render(
      <>
        <input data-testid="some-input" />
        <SpeakerSwitchButtons
          brief={RESCOS_70_BRIEF}
          currentSpeakerId="emma"
          onSwitch={onSwitch}
        />
      </>,
    );
    const input = screen.getByTestId("some-input");
    input.focus();
    const evt = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    input.dispatchEvent(evt);
    expect(onSwitch).not.toHaveBeenCalled();
  });
});
