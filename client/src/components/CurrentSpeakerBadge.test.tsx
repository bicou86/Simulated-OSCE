// Phase 4 J4 — tests du badge persistant « Vous parlez à : … ».
//
// Couvre :
//   • visibilité conditionnelle (mono-patient ⇒ rien rendu),
//   • résolution du participant courant (id matché vs fallback),
//   • affichage du nom + âge + label de rôle,
//   • bascule de couleur d'accent selon le rôle (patient vs accompagnant),
//   • avatar (emoji) cohérent avec l'âge / nom.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CurrentSpeakerBadge } from "./CurrentSpeakerBadge";
import type { PatientBrief } from "@/lib/api";

afterEach(() => cleanup());

const RESCOS_70_BRIEF = {
  stationId: "RESCOS-70",
  setting: "Cabinet",
  patientDescription: "Emma 16 ans + mère",
  vitals: {},
  phraseOuverture: "",
  sex: "female",
  age: 16,
  interlocutor: { type: "self", reason: "test" },
  participants: [
    {
      id: "emma",
      role: "patient",
      name: "Emma Delacroix",
      age: 16,
      vocabulary: "lay",
      knowledgeScope: ["self.symptoms"],
    },
    {
      id: "mother",
      role: "accompanying",
      name: "Mère d'Emma Delacroix",
      vocabulary: "lay",
      knowledgeScope: ["family.history"],
    },
  ],
  defaultSpeakerId: "emma",
} as unknown as PatientBrief;

const MONO_BRIEF = {
  stationId: "RESCOS-1",
  setting: "Cabinet",
  patientDescription: "Adulte 47 ans",
  vitals: {},
  phraseOuverture: "",
  sex: "female",
  age: 47,
  interlocutor: { type: "self", reason: "adult" },
} as unknown as PatientBrief;

describe("CurrentSpeakerBadge", () => {
  it("renders nothing for a mono-patient station (rétrocompat 100 %)", () => {
    const { container } = render(
      <CurrentSpeakerBadge brief={MONO_BRIEF} currentSpeakerId="patient" />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("current-speaker-badge")).toBeNull();
  });

  it("multi-profile + speaker=emma → badge avec Emma + avatar 🧑 (16 ans)", () => {
    render(<CurrentSpeakerBadge brief={RESCOS_70_BRIEF} currentSpeakerId="emma" />);
    const badge = screen.getByTestId("current-speaker-badge");
    expect(badge).toBeDefined();
    expect(badge.dataset.speakerId).toBe("emma");
    expect(badge.dataset.speakerRole).toBe("patient");
    expect(badge.textContent).toMatch(/Emma Delacroix/);
    expect(badge.textContent).toMatch(/16/);
    expect(badge.textContent).toMatch(/patient/i);
    // Avatar 🧑 (16 ans = adolescent⇒adulte fourchette < 60)
    expect(badge.textContent).toMatch(/🧑/);
  });

  it("multi-profile + speaker=mother → badge avec mère + avatar 👩 + role accompagnant·e", () => {
    render(<CurrentSpeakerBadge brief={RESCOS_70_BRIEF} currentSpeakerId="mother" />);
    const badge = screen.getByTestId("current-speaker-badge");
    expect(badge.dataset.speakerId).toBe("mother");
    expect(badge.dataset.speakerRole).toBe("accompanying");
    expect(badge.textContent).toMatch(/Mère d'Emma Delacroix/);
    expect(badge.textContent).toMatch(/accompagnant/i);
    expect(badge.textContent).toMatch(/👩/);
  });

  it("speakerId inconnu → fallback sur le 1er participant (pas d'écran vide)", () => {
    render(<CurrentSpeakerBadge brief={RESCOS_70_BRIEF} currentSpeakerId="ghost" />);
    const badge = screen.getByTestId("current-speaker-badge");
    expect(badge.dataset.speakerId).toBe("emma");
  });

  it("currentSpeakerId=null + ≥ 2 participants → badge sur le 1er participant (T0 défensif)", () => {
    render(<CurrentSpeakerBadge brief={RESCOS_70_BRIEF} currentSpeakerId={null} />);
    const badge = screen.getByTestId("current-speaker-badge");
    // Le brief.defaultSpeakerId vaut "emma" mais le composant n'y
    // accède pas — il prend le premier participant déclaré.
    expect(badge.dataset.speakerId).toBe("emma");
  });
});
