// Phase 3 J3 — tests déterministes du sélecteur de profil de spécialité.
// Pur TS : pas de mocks, pas d'I/O.

import { describe, expect, it } from "vitest";
import {
  buildSpecialtyDirective,
  parseStationAgeYears,
  selectSpecialtyProfile,
} from "../services/specialtyProfileSelector";

describe("parseStationAgeYears", () => {
  it("prioritizes patient_age_years numeric field", () => {
    expect(parseStationAgeYears({ patient_age_years: 16, age: "45 ans" })).toBe(16);
  });

  it("parses age number directly", () => {
    expect(parseStationAgeYears({ age: 50 })).toBe(50);
  });

  it("parses age string (ans)", () => {
    expect(parseStationAgeYears({ age: "47 ans" })).toBe(47);
    expect(parseStationAgeYears({ age: "2 ans" })).toBe(2);
  });

  it("parses age from patient_description (fallback)", () => {
    expect(parseStationAgeYears({ patient_description: "Homme de 45 ans" })).toBe(45);
    expect(parseStationAgeYears({ patient_description: "Fillette de 2 ans" })).toBe(2);
  });

  it("converts mois to fraction of year", () => {
    expect(parseStationAgeYears({ age: "6 mois" })).toBeCloseTo(0.5);
  });

  it("returns null when no source usable", () => {
    expect(parseStationAgeYears({})).toBeNull();
    expect(parseStationAgeYears({ patient_description: "Adulte d'âge moyen" })).toBeNull();
  });
});

describe("selectSpecialtyProfile — priority rules", () => {
  it("register:palliatif wins over age", () => {
    expect(
      selectSpecialtyProfile({ register: "palliatif", patient_age_years: 16 }),
    ).toBe("palliatif");
  });

  it("register:gyneco selected", () => {
    expect(selectSpecialtyProfile({ register: "gyneco", age: "50 ans" })).toBe("gyneco");
  });

  it("adolescent triggered by age 14-17 without register", () => {
    expect(selectSpecialtyProfile({ patient_age_years: 14 })).toBe("adolescent");
    expect(selectSpecialtyProfile({ patient_age_years: 16 })).toBe("adolescent");
    expect(selectSpecialtyProfile({ patient_age_years: 17 })).toBe("adolescent");
  });

  it("age 13 does NOT trigger adolescent (still pediatric-accompanist territory)", () => {
    expect(selectSpecialtyProfile({ patient_age_years: 13 })).toBeNull();
  });

  it("age 18 does NOT trigger adolescent (adult)", () => {
    expect(selectSpecialtyProfile({ patient_age_years: 18 })).toBeNull();
  });

  it("age 2 (fillette) does NOT trigger adolescent", () => {
    expect(
      selectSpecialtyProfile({ patient_description: "Fillette de 2 ans" }),
    ).toBeNull();
  });

  it("no register and no eligible age → null (Phase 2 station default)", () => {
    expect(
      selectSpecialtyProfile({
        age: "47 ans",
        patient_description: "Femme de 47 ans",
      }),
    ).toBeNull();
  });

  it("register case-insensitive", () => {
    expect(selectSpecialtyProfile({ register: "GYNECO" })).toBe("gyneco");
    expect(selectSpecialtyProfile({ register: "Palliatif" })).toBe("palliatif");
  });

  it("unknown register string → falls through to age rule", () => {
    expect(
      selectSpecialtyProfile({ register: "unknown-tag", patient_age_years: 16 }),
    ).toBe("adolescent");
    expect(selectSpecialtyProfile({ register: "unknown-tag" })).toBeNull();
  });
});

describe("buildSpecialtyDirective — template-specific mapping", () => {
  it("patient + gyneco → Profil A with A1-A4 examples", () => {
    const d = buildSpecialtyDirective("gyneco", "patient");
    expect(d).toContain("Profil A");
    expect(d).toContain("A1, A2, A3, A4");
  });

  it("patient + adolescent → Profil B with B1-B3", () => {
    const d = buildSpecialtyDirective("adolescent", "patient");
    expect(d).toContain("Profil B");
    expect(d).toContain("B1, B2, B3");
  });

  it("patient + palliatif → Profil C with C1-C3", () => {
    const d = buildSpecialtyDirective("palliatif", "patient");
    expect(d).toContain("Profil C");
    expect(d).toContain("C1, C2, C3");
  });

  it("caregiver + adolescent → Profil P1 with E, F, G", () => {
    const d = buildSpecialtyDirective("adolescent", "caregiver");
    expect(d).toContain("Profil P1");
    expect(d).toContain("E, F, G");
  });

  it("caregiver + palliatif → Profil P2 with H, I, J", () => {
    const d = buildSpecialtyDirective("palliatif", "caregiver");
    expect(d).toContain("Profil P2");
    expect(d).toContain("H, I, J");
  });

  it("caregiver + gyneco → empty (no dedicated accompanist gyneco profile)", () => {
    expect(buildSpecialtyDirective("gyneco", "caregiver")).toBe("");
  });

  it("null profile → empty directive (backwards compatibility)", () => {
    expect(buildSpecialtyDirective(null, "patient")).toBe("");
    expect(buildSpecialtyDirective(null, "caregiver")).toBe("");
  });

  it("directive contains PROFIL ACTIF marker for traceability", () => {
    expect(buildSpecialtyDirective("gyneco", "patient")).toContain("PROFIL ACTIF");
  });
});
