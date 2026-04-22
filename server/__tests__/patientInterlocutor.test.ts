// Tests de resolveInterlocutor — règles de priorité :
//   1. marqueur explicite "présenté par sa mère/son père/…"
//   2. non-coopération (inconscient, comateux, non-verbal, dément)
//   3. age < 4 → parent (mère par défaut)
//   4. age < 12 → self + parentPresent
//   5. sinon → self

import { describe, expect, it } from "vitest";
import { resolveInterlocutor, interlocutorLabel, interlocutorArticle } from "../lib/patientInterlocutor";

describe("resolveInterlocutor", () => {
  it("detects explicit 'présentée par sa mère' → parent/mother", () => {
    const r = resolveInterlocutor({
      patientDescription: "Virginia Jameson, fillette de 2 ans, présentée par sa mère pour toux et fièvre",
      age: 2,
      sex: "female",
    });
    expect(r.type).toBe("parent");
    expect(r.parentRole).toBe("mother");
    expect(r.reason).toMatch(/marqueur explicite/);
  });

  it("detects 'présenté par son père' → parent/father", () => {
    const r = resolveInterlocutor({
      patientDescription: "Leo Morris, garçon de 6 ans, présenté par son père pour douleurs abdominales",
      age: 6,
      sex: "male",
    });
    expect(r.type).toBe("parent");
    expect(r.parentRole).toBe("father");
  });

  it("detects 'Mère d'un garçon de 6 ans' (description du parent) → parent/mother", () => {
    const r = resolveInterlocutor({
      patientDescription: "Mère d'un garçon de 6 ans qui a de la fièvre",
      age: 6,
      sex: "male",
    });
    expect(r.type).toBe("parent");
    expect(r.parentRole).toBe("mother");
  });

  it("explicit parent marker wins over age-based rule (adolescent présenté par sa mère)", () => {
    // 15 ans mais accompagné par la mère explicitement → parent
    const r = resolveInterlocutor({
      patientDescription: "Adolescent de 15 ans présenté par sa mère suite à une crise",
      age: 15,
      sex: "male",
    });
    expect(r.type).toBe("parent");
    expect(r.parentRole).toBe("mother");
  });

  it("infant (age < 4) with no marker → parent/mother (default)", () => {
    const r = resolveInterlocutor({
      patientDescription: "Nourrisson de 3 mois amené pour vomissements",
      age: 0,
      sex: "unknown",
    });
    expect(r.type).toBe("parent");
    expect(r.parentRole).toBe("mother");
    expect(r.reason).toMatch(/pré-verbal/);
  });

  it("school-age child (4 ≤ age < 12) → self with parentPresent", () => {
    const r = resolveInterlocutor({
      patientDescription: "Garçon de 8 ans avec maux de ventre",
      age: 8,
      sex: "male",
    });
    expect(r.type).toBe("self");
    expect(r.parentPresent).toBe(true);
  });

  it("adolescent (age ≥ 12) → self, no parentPresent", () => {
    const r = resolveInterlocutor({
      patientDescription: "Adolescente de 15 ans pour consultation de suivi",
      age: 15,
      sex: "female",
    });
    expect(r.type).toBe("self");
    expect(r.parentPresent).toBeUndefined();
  });

  it("adult → self", () => {
    const r = resolveInterlocutor({
      patientDescription: "Marcia Billings, femme de 47 ans, consultante pour des douleurs abdominales",
      age: 47,
      sex: "female",
    });
    expect(r.type).toBe("self");
  });

  it("unconscious adult → parent/caregiver", () => {
    const r = resolveInterlocutor({
      patientDescription: "Patient de 68 ans retrouvé inconscient à son domicile",
      age: 68,
      sex: "male",
    });
    expect(r.type).toBe("parent");
    expect(r.parentRole).toBe("caregiver");
  });

  it("demented elderly → parent/caregiver", () => {
    const r = resolveInterlocutor({
      patientDescription: "Madame X, 82 ans, démente, amenée par son fils pour chute",
      age: 82,
      sex: "female",
    });
    // Marqueur "amenée par son fils" — "fils" n'est pas dans notre lexique parent,
    // mais "démente" déclenche la règle non-coopératif → caregiver. Acceptable.
    expect(r.type).toBe("parent");
  });

  it("non-verbal patient → parent/caregiver", () => {
    const r = resolveInterlocutor({
      patientDescription: "Homme de 45 ans non-verbal, accompagné à la consultation",
      age: 45,
      sex: "male",
    });
    expect(r.type).toBe("parent");
    expect(r.parentRole).toBe("caregiver");
  });

  it("age unknown + no marker → self by default", () => {
    const r = resolveInterlocutor({
      patientDescription: "Patient pour consultation de routine",
      age: undefined,
      sex: "male",
    });
    expect(r.type).toBe("self");
  });
});

describe("interlocutorLabel / interlocutorArticle", () => {
  it("self → 'Patient' / 'le patient'", () => {
    expect(interlocutorLabel({ type: "self", reason: "x" })).toBe("Patient");
    expect(interlocutorArticle({ type: "self", reason: "x" })).toBe("le patient");
  });

  it("mother → 'Mère du patient' / 'la mère'", () => {
    const it = { type: "parent" as const, parentRole: "mother" as const, reason: "x" };
    expect(interlocutorLabel(it)).toBe("Mère du patient");
    expect(interlocutorArticle(it)).toBe("la mère");
  });

  it("father → 'Père du patient' / 'le père'", () => {
    const it = { type: "parent" as const, parentRole: "father" as const, reason: "x" };
    expect(interlocutorLabel(it)).toBe("Père du patient");
    expect(interlocutorArticle(it)).toBe("le père");
  });

  it("caregiver → 'Accompagnant·e' / \"l'accompagnant·e\"", () => {
    const it = { type: "parent" as const, parentRole: "caregiver" as const, reason: "x" };
    expect(interlocutorLabel(it)).toBe("Accompagnant·e");
    expect(interlocutorArticle(it)).toBe("l'accompagnant·e");
  });
});
