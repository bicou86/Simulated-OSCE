// Phase 3 J3 — tests de reproductibilité sur les 3 fixtures gold-standard
// de spécialités (gynéco AMBOSS-4, ado RESCOS-70, palliatif RESCOS-71).
//
// Ce que ce test vérifie est DÉTERMINISTE : pour un stationId donné, le system
// prompt assemblé par `buildSystemPrompt()` contient systématiquement la bonne
// directive de profil et le bon template. Un changement fortuit dans la
// plomberie (classifier, selector, register, age parsing) fera échouer ce
// test immédiatement.
//
// Ce que ce test NE vérifie PAS : la sortie effective du LLM patient. Avec
// temperature > 0 le contenu exact n'est pas reproductible ; les fixtures
// contiennent des conversations "gold-standard" destinées à la relecture
// pédagogique humaine + à d'éventuels tests d'acceptation manuels (UI).

import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { initCatalog } from "../services/stationsService";
import { buildSystemPrompt } from "../services/patientService";

const FIXTURES_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "tests",
  "fixtures",
  "specialties",
);

interface SpecialtyFixture {
  _meta: {
    description: string;
    frozenAt: string;
    gitCommitAtFreeze: string;
    profileUnderTest: "gyneco" | "adolescent" | "palliatif";
    templateUnderTest: "patient" | "caregiver";
    fewShotExercised: string[];
  };
  stationId: string;
  expectedProfile: "gyneco" | "adolescent" | "palliatif";
  expectedTemplate: "patient" | "caregiver";
  expectedDirective: {
    containsName: string;
    containsExamples: string;
  };
  conversations: Array<{
    id: string;
    focus: string;
    pedagogicalChecklist: string[];
    turns: Array<{
      role: string;
      text: string;
      mustContain?: string[];
      mustNotContain?: string[];
      note?: string;
    }>;
  }>;
}

async function loadFixture(filename: string): Promise<SpecialtyFixture> {
  const raw = await fs.readFile(path.join(FIXTURES_DIR, filename), "utf-8");
  return JSON.parse(raw) as SpecialtyFixture;
}

// Boot du catalogue — requis puisque buildSystemPrompt lit la station réelle
// depuis Patient_*.json. Pas de mock ici : on veut vérifier que la plomberie
// réelle délivre bien le profil attendu pour chaque station pilote.
describe("Phase 3 J3 — fixtures gold-standard de spécialités (wiring déterministe)", () => {
  const fixtureFiles = [
    "gyneco-amboss4.json",
    "ado-rescos70.json",
    "palliatif-rescos71.json",
  ];

  it("catalog loads all 3 pilot stations", async () => {
    await initCatalog();
    const { getStationMeta } = await import("../services/stationsService");
    expect(getStationMeta("AMBOSS-4")).toBeDefined();
    expect(getStationMeta("RESCOS-70")).toBeDefined();
    expect(getStationMeta("RESCOS-71")).toBeDefined();
  });

  for (const file of fixtureFiles) {
    describe(`fixture ${file}`, () => {
      it("loads a well-formed fixture with 3 conversations", async () => {
        const fx = await loadFixture(file);
        expect(fx.stationId).toBeTruthy();
        expect(fx.expectedProfile).toMatch(/^(gyneco|adolescent|palliatif)$/);
        expect(fx.expectedTemplate).toMatch(/^(patient|caregiver)$/);
        expect(fx.conversations).toHaveLength(3);
        for (const conv of fx.conversations) {
          expect(conv.turns.length).toBeGreaterThan(0);
          expect(conv.pedagogicalChecklist.length).toBeGreaterThanOrEqual(3);
        }
      });

      it("buildSystemPrompt() injects the expected profile directive", async () => {
        await initCatalog();
        const fx = await loadFixture(file);
        const prompt = await buildSystemPrompt(fx.stationId, "voice");

        // Directive injectée
        expect(prompt).toContain("PROFIL ACTIF");
        expect(prompt).toContain(fx.expectedDirective.containsName);
        expect(prompt).toContain(fx.expectedDirective.containsExamples);

        // Template correct (on reconnaît patient.md à "Patient Standardisé",
        // caregiver.md à "Accompagnant·e").
        if (fx.expectedTemplate === "caregiver") {
          expect(prompt).toContain("Accompagnant");
        } else {
          expect(prompt).toContain("Patient Standardisé");
        }

        // Données de station bien insérées
        expect(prompt).toContain("<station_data>");
        expect(prompt).toContain(fx.stationId);
      });

      it("each conversation has gold-standard turns with content markers", async () => {
        const fx = await loadFixture(file);
        for (const conv of fx.conversations) {
          for (const turn of conv.turns) {
            // Chaque tour "gold" a du texte (sauf turns narratifs annotés)
            if (turn.note) continue;
            expect(turn.text.length).toBeGreaterThan(0);
            if (turn.mustContain) {
              for (const needle of turn.mustContain) {
                // On vérifie juste que la string attendue est lisible dans le
                // texte du tour gold (les productions LLM sont comparées à la
                // main en UI test, pas ici).
                expect(turn.text.toLowerCase()).toContain(needle.toLowerCase());
              }
            }
          }
        }
      });

      it("pilot station carries the correct additive flags on disk", async () => {
        const fx = await loadFixture(file);
        const { getPatientStation } = await import("../services/patientService");
        const station = await getPatientStation(fx.stationId);
        // Gyneco et palliatif doivent porter register explicite.
        if (fx.expectedProfile === "gyneco") {
          expect(station.register).toBe("gyneco");
        }
        if (fx.expectedProfile === "palliatif") {
          expect(station.register).toBe("palliatif");
        }
        // L'adolescent est dérivé de l'âge uniquement (pas de register).
        if (fx.expectedProfile === "adolescent") {
          const age = station.patient_age_years
            ?? parseInt(String(station.age ?? "").match(/\d+/)?.[0] ?? "0", 10);
          expect(age).toBeGreaterThanOrEqual(14);
          expect(age).toBeLessThanOrEqual(17);
        }
      });
    });
  }

  // Phase 2 témoins : un test discret par station (it.each) pour qu'une
  // régression sur l'une d'elles produise un échec ciblé, pas un échec global
  // qui masque les autres.
  describe.each([
    "AMBOSS-1",
    "AMBOSS-7",
    "RESCOS-7",
    "RESCOS-9b",
    "German-2",
    "German-4",
  ])("non-regression: Phase 2 witness %s receives NO specialty directive", (stationId) => {
    it("buildSystemPrompt does not inject PROFIL ACTIF", async () => {
      await initCatalog();
      const prompt = await buildSystemPrompt(stationId, "voice");
      expect(prompt).not.toContain("PROFIL ACTIF");
    });
  });
});

// Phase 3 J4 — fixture P1-bis (parent insistant). Schéma branchu (success/failure)
// distinct des fixtures J3 conversations[]. Validation déterministe : structure +
// invariants globaux (Emma ne révèle JAMAIS la pilule devant la mère).
describe("Phase 3 J4 — fixture P1-bis ado-rescos70-parent-insistant (branched)", () => {
  interface BranchedFixture {
    _meta: { description: string; profileUnderTest: string; templateUnderTest: string; siblingOf?: string };
    stationId: string;
    expectedProfile: string;
    expectedTemplate: string;
    scenarioVariant: string;
    globalMustNotContain: string[];
    branches: Array<{
      id: string;
      outcome: "success" | "failure";
      summary: string;
      pedagogicalChecklist: string[];
      turns: Array<{
        role: string;
        text: string;
        speaker?: string;
        narrativeOnly?: boolean;
        annotation?: string;
        mustContain?: string[];
        mustNotContain?: string[];
      }>;
    }>;
  }

  async function loadBranchedFixture(): Promise<BranchedFixture> {
    const raw = await fs.readFile(
      path.join(FIXTURES_DIR, "ado-rescos70-parent-insistant.json"),
      "utf-8",
    );
    return JSON.parse(raw) as BranchedFixture;
  }

  it("loads with expected structure (RESCOS-70, adolescent profile, 2 branches)", async () => {
    const fx = await loadBranchedFixture();
    expect(fx.stationId).toBe("RESCOS-70");
    expect(fx.expectedProfile).toBe("adolescent");
    expect(fx.expectedTemplate).toBe("patient");
    expect(fx.scenarioVariant).toBe("parent-insiste-fort");
    expect(fx.branches).toHaveLength(2);
    const outcomes = fx.branches.map((b) => b.outcome).sort();
    expect(outcomes).toEqual(["failure", "success"]);
  });

  it("Branch A (success) escalates mother turns BEFORE candidate invokes confidentiality framework", async () => {
    const fx = await loadBranchedFixture();
    const branchA = fx.branches.find((b) => b.outcome === "success");
    expect(branchA).toBeDefined();
    const motherTurns = branchA!.turns.filter((t) => t.role === "mother_gold");
    // Au moins 3 tours d'escalade côté mère (cf. spec J4 : 3-4 tours).
    expect(motherTurns.length).toBeGreaterThanOrEqual(3);
    // mustContain attendus sur les tours de la mère, agrégés.
    const allMotherText = motherTurns.map((t) => t.text.toLowerCase()).join(" ");
    expect(allMotherText).toContain("mère");
    expect(allMotherText).toContain("rester");
    expect(allMotherText).toContain("j'ai le droit");
    expect(allMotherText).toContain("ma fille");
  });

  it("Branch A — Emma reveals pill ONLY after mother is out + candidate stated confidentiality", async () => {
    const fx = await loadBranchedFixture();
    const branchA = fx.branches.find((b) => b.outcome === "success");
    const lastEmmaTurn = [...branchA!.turns].reverse().find(
      (t) => t.role === "patient_gold" && !t.narrativeOnly,
    );
    expect(lastEmmaTurn).toBeDefined();
    expect(lastEmmaTurn!.text.toLowerCase()).toContain("pilule");
    expect(lastEmmaTurn!.text.toLowerCase()).toContain("trois mois");
  });

  it("Branch B (failure) — mother stays, Emma never reveals pill or boyfriend", async () => {
    const fx = await loadBranchedFixture();
    const branchB = fx.branches.find((b) => b.outcome === "failure");
    expect(branchB).toBeDefined();
    const allEmmaText = branchB!.turns
      .filter((t) => t.role === "patient_gold")
      .map((t) => t.text.toLowerCase())
      .join(" ");
    for (const forbidden of fx.globalMustNotContain) {
      expect(allEmmaText).not.toContain(forbidden.toLowerCase());
    }
  });

  it("Global invariant: across BOTH branches, no Emma turn mentions pill while mother is in the room", async () => {
    const fx = await loadBranchedFixture();
    for (const branch of fx.branches) {
      let motherInRoom = true;
      for (const turn of branch.turns) {
        // La mère sort dès qu'on rencontre une annotation 'cède au cadre' ou
        // un turn doctor "Madame ... salle d'attente ... Cinq minutes."
        if (
          turn.role === "mother_gold" &&
          turn.annotation &&
          turn.annotation.toLowerCase().includes("cède")
        ) {
          motherInRoom = false;
          continue;
        }
        if (turn.role !== "patient_gold" || turn.narrativeOnly) continue;
        if (motherInRoom) {
          const t = turn.text.toLowerCase();
          for (const forbidden of fx.globalMustNotContain) {
            expect(t).not.toContain(forbidden.toLowerCase());
          }
        }
      }
    }
  });

  it("buildSystemPrompt(RESCOS-70) still injects Profil B directive (parent-insistant variant doesn't change wiring)", async () => {
    await initCatalog();
    const prompt = await buildSystemPrompt("RESCOS-70", "voice");
    expect(prompt).toContain("PROFIL ACTIF");
    expect(prompt).toContain("Profil B");
    expect(prompt).toContain("B1, B2, B3");
  });
});
