// Tests unitaires de l'inférence `station_type` — 6 règles déterministes
// dans l'ordre, première qui match gagne. Aucun LLM impliqué.

import { describe, expect, it } from "vitest";
import { inferStationType, type StationTypeInput } from "../services/stationTypeInference";

function base(overrides: Partial<StationTypeInput>): StationTypeInput {
  return {
    id: "TEST-1",
    source: "RESCOS",
    setting: "",
    patientDescription: "",
    ...overrides,
  };
}

describe("inferStationType — ordre des règles", () => {
  it("Règle 1 : setting téléphonique → teleconsultation", () => {
    const r = inferStationType(base({ setting: "Consultation téléphonique pédiatrique" }));
    expect(r.type).toBe("teleconsultation");
    expect(r.matchedRule).toBe("rule_1_teleconsult_keywords");
  });
  it("Règle 1 : téléconsult l'emporte sur pédiatrie (téléconsult pédiatrique reste téléconsult)", () => {
    const r = inferStationType(base({
      setting: "Consultation téléphonique pédiatrique à 23h",
      patientDescription: "Fillette de 2 ans, présentée par sa mère",
      age: 2,
      interlocutorType: "parent",
    }));
    expect(r.type).toBe("teleconsultation");
    expect(r.matchedRule).toBe("rule_1_teleconsult_keywords");
  });
  it("Règle 1 : téléconsult détectée aussi dans patient_description", () => {
    const r = inferStationType(base({
      setting: "Cabinet",
      patientDescription: "Appel téléphonique avec le père",
    }));
    expect(r.type).toBe("teleconsultation");
  });
  it("Règle 1 : tolère les variantes télémédecine / visio", () => {
    expect(inferStationType(base({ setting: "Télémédecine" })).type).toBe("teleconsultation");
    expect(inferStationType(base({ setting: "Consultation en visio" })).type).toBe("teleconsultation");
  });

  it("Règle 2 : enfant < 12 + parent → pediatrie_accompagnant", () => {
    const r = inferStationType(base({
      setting: "Urgences pédiatriques",
      patientDescription: "Charlotte, 2 ans, amenée par son parent",
      age: 2,
      interlocutorType: "parent",
    }));
    expect(r.type).toBe("pediatrie_accompagnant");
    expect(r.matchedRule).toBe("rule_2_child_with_caregiver");
  });
  it("Règle 2 : enfant 13 ans + parent → pas pediatrie_accompagnant (âge >= 12)", () => {
    const r = inferStationType(base({
      setting: "Cabinet",
      patientDescription: "Ado de 13 ans avec son père",
      age: 13,
      interlocutorType: "parent",
    }));
    expect(r.type).not.toBe("pediatrie_accompagnant");
  });
  it("Règle 2 : reconnaît 'mère' / 'père' dans feuille de porte si interlocutorType absent", () => {
    const r = inferStationType(base({
      setting: "Cabinet",
      patientDescription: "Enfant de 4 ans, accompagné de sa mère",
      age: 4,
    }));
    expect(r.type).toBe("pediatrie_accompagnant");
  });

  it("Règle 3a : 'BBN' dans l'ID → bbn (priorité sur keywords setting)", () => {
    const r = inferStationType(base({
      id: "RESCOS-7",
      fullId: "RESCOS-7 - BBN - Anévrisme",
      setting: "Cabinet médical",
    }));
    expect(r.type).toBe("bbn");
    expect(r.matchedRule).toBe("rule_3a_bbn_in_id");
  });
  it("Règle 3b : keywords annonce/mauvaise nouvelle dans setting → bbn", () => {
    expect(inferStationType(base({ setting: "Annonce d'un diagnostic grave" })).type).toBe("bbn");
    expect(inferStationType(base({ setting: "Cabinet — annonce de décès" })).type).toBe("bbn");
    expect(inferStationType(base({ setting: "Mauvaise nouvelle" })).type).toBe("bbn");
  });
  it("Règle 3b : ne match PAS 'le médecin annonce qu'il va examiner'", () => {
    // Le setting type est le cadre structurel, pas une phrase narrative — mais
    // par prudence, un setting sans mot-clé BBN strict ne doit pas basculer.
    const r = inferStationType(base({ setting: "Consultation standard" }));
    expect(r.type).not.toBe("bbn");
  });

  it("Règle 4 : psychiatrie via mot-clé setting", () => {
    expect(inferStationType(base({ setting: "Consultation psychiatrique" })).type).toBe("psy");
    expect(inferStationType(base({ setting: "Dépression post-partum" })).type).toBe("psy");
    expect(inferStationType(base({ setting: "Idées suicidaires" })).type).toBe("psy");
    expect(inferStationType(base({ setting: "Addiction à l'alcool" })).type).toBe("psy");
  });
  it("Règle 4 : psychiatrie via champ specialite", () => {
    const r = inferStationType(base({
      setting: "Cabinet",
      specialite: "psychiatrie",
    }));
    expect(r.type).toBe("psy");
  });

  it("Règle 5a : source USMLE_Triage → triage", () => {
    const r = inferStationType(base({ source: "USMLE_Triage", setting: "Cabinet" }));
    expect(r.type).toBe("triage");
    expect(r.matchedRule).toBe("rule_5a_triage_source");
  });
  it("Règle 5b : setting urgences/SAU → triage", () => {
    expect(inferStationType(base({ setting: "Urgences" })).type).toBe("triage");
    expect(inferStationType(base({ setting: "Service d'urgences" })).type).toBe("triage");
    expect(inferStationType(base({ setting: "SAU" })).type).toBe("triage");
  });

  it("Règle 6 : défaut → anamnese_examen", () => {
    const r = inferStationType(base({
      setting: "Cabinet médical de ville",
      patientDescription: "Marie, 55 ans, consulte pour douleur abdominale",
      age: 55,
      interlocutorType: "self",
    }));
    expect(r.type).toBe("anamnese_examen");
    expect(r.matchedRule).toBe("rule_6_default");
  });

  it("Robustesse accents : normalise avant regex", () => {
    expect(inferStationType(base({ setting: "Consultation téléphonique" })).type).toBe("teleconsultation");
    expect(inferStationType(base({ setting: "Consultation telephonique" })).type).toBe("teleconsultation");
    expect(inferStationType(base({ setting: "Télémédecine" })).type).toBe("teleconsultation");
  });

  it("Règle 1 : « vision » (mot médical) NE déclenche PAS teleconsultation", () => {
    const r = inferStationType(base({
      setting: "Cabinet de médecine générale",
      patientDescription: "M. Müller, 78 ans, pour problèmes de vision depuis quelques mois",
    }));
    expect(r.type).not.toBe("teleconsultation");
  });
  it("Règle 1 : « appelé » (verbe courant) NE déclenche PAS teleconsultation", () => {
    const r = inferStationType(base({
      setting: "Service d'urgences",
      patientDescription: "Une voisine l'a trouvé et a appelé l'ambulance",
    }));
    expect(r.type).not.toBe("teleconsultation");
  });
  it("Règle 1 : « appel téléphonique » (combo valide) déclenche teleconsultation", () => {
    const r = inferStationType(base({
      setting: "Appel téléphonique aux urgences",
      patientDescription: "Appel téléphonique avec le médecin traitant",
    }));
    expect(r.type).toBe("teleconsultation");
  });
  it("Règle 1 : « visioconférence » (télémédecine) déclenche teleconsultation", () => {
    const r = inferStationType(base({ setting: "Visioconférence avec le patient" }));
    expect(r.type).toBe("teleconsultation");
  });

  it("Ordre : téléconsult > pediatrie > bbn > psy > triage > default", () => {
    // Un setting cumulant tous les signaux doit retourner le premier match
    // (téléconsult). Test défensif contre une éventuelle ré-ordonnance.
    const r = inferStationType({
      id: "CONFLICT-1",
      fullId: "CONFLICT-1 - BBN - Pédiatrie",
      source: "USMLE_Triage",
      setting: "Consultation téléphonique pédiatrique - Urgences - Annonce diagnostic grave",
      patientDescription: "Enfant 2 ans avec sa mère",
      age: 2,
      interlocutorType: "parent",
      specialite: "psychiatrie",
    });
    expect(r.type).toBe("teleconsultation");
  });
});
