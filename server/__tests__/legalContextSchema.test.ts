// Phase 5 J1 — tests Zod du schéma additif `legalContext`.
//
// Couvre :
//   • parsing d'un legalContext valide (les 9 champs présents),
//   • parsing d'un legalContext sans `jurisdiction` (default CH),
//   • rejets sur valeurs hors enum (category, subject_status,
//     expected_decision, jurisdiction),
//   • rejets sur champs requis manquants,
//   • rejets sur arrays vides,
//   • parsing d'une station avec/sans legalContext (rétrocompat),
//   • lecture des 3 pilotes Phase 5 sur disque (intégrité fixtures).

import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import {
  legalContextSchema,
  stationSchema,
  type LegalContext,
} from "@shared/station-schema";

const PATIENT_DIR = path.resolve(__dirname, "..", "data", "patient");

async function loadStationRaw(file: string, shortId: string): Promise<any> {
  const raw = await fs.readFile(path.join(PATIENT_DIR, file), "utf-8");
  const parsed = JSON.parse(raw) as { stations: Array<{ id: string }> };
  return parsed.stations.find((s) => s.id.startsWith(shortId + " "));
}

const VALID_LEGAL: LegalContext = {
  category: "secret_pro_levee",
  jurisdiction: "CH",
  subject_status: "adult_capable",
  applicable_law: ["CP-321"],
  mandatory_reporting: false,
  expected_decision: "refer",
  decision_rationale: "Secret pro absolu, droit d'aviser sous conditions",
  red_flags: ["ecchymoses multiples", "histoire incohérente"],
  candidate_must_verbalize: ["secret professionnel"],
  candidate_must_avoid: ["promettre confidentialité absolue"],
};

describe("legalContextSchema (Phase 5 J1)", () => {
  it("parses a fully-populated valid context", () => {
    const r = legalContextSchema.safeParse(VALID_LEGAL);
    expect(r.success).toBe(true);
  });

  it("parses without jurisdiction (default CH côté UI)", () => {
    const { jurisdiction, ...rest } = VALID_LEGAL;
    void jurisdiction;
    const r = legalContextSchema.safeParse(rest);
    expect(r.success).toBe(true);
  });

  it("rejects an invalid category", () => {
    const r = legalContextSchema.safeParse({ ...VALID_LEGAL, category: "garbage" });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid subject_status", () => {
    const r = legalContextSchema.safeParse({
      ...VALID_LEGAL,
      subject_status: "ado",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid expected_decision", () => {
    const r = legalContextSchema.safeParse({
      ...VALID_LEGAL,
      expected_decision: "send_to_jail",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid jurisdiction code", () => {
    const r = legalContextSchema.safeParse({ ...VALID_LEGAL, jurisdiction: "FR-FR" });
    expect(r.success).toBe(false);
  });

  it("rejects a missing required field (decision_rationale)", () => {
    const { decision_rationale, ...rest } = VALID_LEGAL;
    void decision_rationale;
    const r = legalContextSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects empty applicable_law", () => {
    const r = legalContextSchema.safeParse({ ...VALID_LEGAL, applicable_law: [] });
    expect(r.success).toBe(false);
  });

  it("rejects empty red_flags", () => {
    const r = legalContextSchema.safeParse({ ...VALID_LEGAL, red_flags: [] });
    expect(r.success).toBe(false);
  });

  it("rejects empty candidate_must_verbalize", () => {
    const r = legalContextSchema.safeParse({
      ...VALID_LEGAL,
      candidate_must_verbalize: [],
    });
    expect(r.success).toBe(false);
  });

  it("accepts EMPTY candidate_must_avoid (anti-patterns sont optionnels)", () => {
    const r = legalContextSchema.safeParse({
      ...VALID_LEGAL,
      candidate_must_avoid: [],
    });
    expect(r.success).toBe(true);
  });

  it("rejects mandatory_reporting non-boolean", () => {
    const r = legalContextSchema.safeParse({
      ...VALID_LEGAL,
      mandatory_reporting: "yes",
    });
    expect(r.success).toBe(false);
  });
});

describe("stationSchema avec legalContext (rétrocompat)", () => {
  it("station mono-patient legacy SANS legalContext parse normalement", () => {
    const station = {
      id: "TEST-MONO",
      nom: "Patient X",
      patient_description: "X is sick",
    };
    const r = stationSchema.safeParse(station);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.legalContext).toBeUndefined();
  });

  it("station avec legalContext valide parse + expose le champ typé", () => {
    const station = { id: "TEST-LEGAL", nom: "X", legalContext: VALID_LEGAL };
    const r = stationSchema.safeParse(station);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.legalContext).toBeDefined();
      expect(r.data.legalContext?.category).toBe("secret_pro_levee");
    }
  });

  it("station avec legalContext invalide REJETÉE par le validateur boot", () => {
    const station = {
      id: "TEST-BAD",
      nom: "X",
      legalContext: { category: "wrong_category" },
    };
    const r = stationSchema.safeParse(station);
    expect(r.success).toBe(false);
  });
});

describe("Pilotes Phase 5 — intégrité fixtures sur disque", () => {
  const PILOTS: Array<{ file: string; sid: string; expectedCategory: string; expectedDecision: string }> = [
    {
      file: "Patient_AMBOSS_2.json",
      sid: "AMBOSS-24",
      expectedCategory: "secret_pro_levee",
      expectedDecision: "refer",
    },
    {
      file: "Patient_USMLE_2.json",
      sid: "USMLE-34",
      expectedCategory: "signalement_maltraitance",
      expectedDecision: "report",
    },
    {
      file: "Patient_RESCOS_4.json",
      sid: "RESCOS-72",
      expectedCategory: "certificat_complaisance",
      expectedDecision: "decline_certificate",
    },
  ];

  it.each(PILOTS)(
    "$sid parse via stationSchema + porte legalContext.category=$expectedCategory + expected_decision=$expectedDecision",
    async ({ file, sid, expectedCategory, expectedDecision }) => {
      const station = await loadStationRaw(file, sid);
      expect(station).toBeDefined();
      const r = stationSchema.safeParse(station);
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.legalContext).toBeDefined();
        expect(r.data.legalContext?.category).toBe(expectedCategory);
        expect(r.data.legalContext?.expected_decision).toBe(expectedDecision);
        // Tous les champs requis présents.
        expect(r.data.legalContext?.subject_status).toBeDefined();
        expect(r.data.legalContext?.applicable_law.length).toBeGreaterThanOrEqual(1);
        expect(r.data.legalContext?.red_flags.length).toBeGreaterThanOrEqual(1);
        expect(r.data.legalContext?.candidate_must_verbalize.length).toBeGreaterThanOrEqual(1);
        expect(typeof r.data.legalContext?.mandatory_reporting).toBe("boolean");
        expect(typeof r.data.legalContext?.decision_rationale).toBe("string");
      }
    },
  );

  it("USMLE-34 (enfants exposés) ⇒ mandatory_reporting=true", async () => {
    const station = await loadStationRaw("Patient_USMLE_2.json", "USMLE-34");
    expect(station.legalContext.mandatory_reporting).toBe(true);
    // L'arsenal pour enfants en danger doit être référencé.
    const laws = station.legalContext.applicable_law as string[];
    expect(laws.some((l) => /364bis|443a|307/.test(l))).toBe(true);
  });

  it("AMBOSS-24 (adulte capable, pas d'enfants) ⇒ mandatory_reporting=false + decision=refer", async () => {
    const station = await loadStationRaw("Patient_AMBOSS_2.json", "AMBOSS-24");
    expect(station.legalContext.mandatory_reporting).toBe(false);
    expect(station.legalContext.expected_decision).toBe("refer");
  });

  it("RESCOS-72 (certificat de complaisance) ⇒ decline_certificate + CP-318 dans applicable_law", async () => {
    const station = await loadStationRaw("Patient_RESCOS_4.json", "RESCOS-72");
    expect(station.legalContext.expected_decision).toBe("decline_certificate");
    expect(station.legalContext.applicable_law).toEqual(
      expect.arrayContaining(["CP-318"]),
    );
  });

  it("RESCOS-72 reste self-consistent SANS legalContext (rétrocompat additif)", async () => {
    const station = await loadStationRaw("Patient_RESCOS_4.json", "RESCOS-72");
    // Construire une copie sans legalContext et vérifier que la station
    // satisfait toujours stationSchema (i.e. la station « tourne quand
    // même » au sens additif).
    const copy = JSON.parse(JSON.stringify(station));
    delete copy.legalContext;
    const r = stationSchema.safeParse(copy);
    expect(r.success).toBe(true);
    // Champs cliniques minimums présents (vérifient que la station n'est
    // pas dépendante de legalContext pour exister).
    expect(typeof copy.id).toBe("string");
    expect(typeof copy.patient_description).toBe("string");
    expect(typeof copy.vitals).toBe("object");
    expect(typeof copy.histoire_actuelle).toBe("object");
    expect(Array.isArray(copy.consignes_jeu)).toBe(true);
  });
});
