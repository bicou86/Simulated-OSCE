// Tests de l'extracteur de sexe à partir de `patient_description`.
// Couvre les patterns présents dans le corpus réel des 570 stations (femme/homme,
// fillette/garçon, nourrisson, consultante/consultant, présentée/présenté).

import { beforeEach, describe, expect, it } from "vitest";
import { extractAge, extractSex, resetSexCache } from "../lib/patientSex";

describe("extractSex", () => {
  beforeEach(() => resetSexCache());

  it.each<[string, "male" | "female"]>([
    ["Marcia Billings, femme de 47 ans, consultante pour des douleurs abdominales", "female"],
    ["Sophia Benedikt, femme de 19 ans, consultante pour des nausées", "female"],
    ["Virginia Jameson, fillette de 2 ans, présentée par sa mère pour toux et fièvre", "female"],
    ["Une patiente de 60 ans se présente", "female"],
    ["Madame X, 45 ans", "female"],
    ["Mme Dumont, consultante", "female"],

    ["John Smith, homme de 32 ans, consultant pour des troubles du transit intestinal", "male"],
    ["Kevin Baker, homme de 71 ans, consultant aux urgences", "male"],
    ["Leo Morris, garçon de 6 ans, présenté par son père", "male"],
    ["Monsieur Dupont, 40 ans", "male"],
    ["Un patient de 55 ans se présente aux urgences", "male"],
  ])("classifies %j as %s", (desc, expected) => {
    expect(extractSex(desc)).toBe(expected);
  });

  it("returns 'unknown' on empty / null / no markers", () => {
    expect(extractSex("")).toBe("unknown");
    expect(extractSex(null)).toBe("unknown");
    expect(extractSex(undefined)).toBe("unknown");
    expect(extractSex("Nourrisson de 3 mois, apporté par les parents")).toBe("unknown");
  });

  it("caches resolution per description", () => {
    const desc = "Femme de 34 ans, consultante";
    const first = extractSex(desc);
    // Seconde résolution servie depuis le cache, même valeur.
    expect(extractSex(desc)).toBe(first);
  });

  it("'patiente' matches female, not male (word-boundary isolates 'patient')", () => {
    expect(extractSex("La patiente se plaint de douleurs")).toBe("female");
    expect(extractSex("Le patient se plaint de douleurs")).toBe("male");
  });
});

describe("extractAge", () => {
  it("parses '47 ans' string field", () => {
    expect(extractAge("47 ans")).toBe(47);
    expect(extractAge("2 ans")).toBe(2);
  });

  it("parses age embedded in free text", () => {
    expect(extractAge("Virginia a 2 ans")).toBe(2);
    expect(extractAge("Père d'un garçon de 6 ans")).toBe(6);
    expect(extractAge("Femme de 47 ans, consultante pour …")).toBe(47);
  });

  it("returns 0 for infant / newborn age formats", () => {
    expect(extractAge("4 mois")).toBe(0);
    expect(extractAge("3 semaines")).toBe(0);
    expect(extractAge("10 jours")).toBe(0);
    expect(extractAge("Mère d'un nouveau-né de 4 jours")).toBe(0);
    expect(extractAge("nouveau-né")).toBe(0);
    expect(extractAge("nouveau né")).toBe(0);
  });

  it("passes a numeric source through", () => {
    expect(extractAge(42)).toBe(42);
    expect(extractAge(0)).toBe(0);
  });

  it("returns undefined when no source is parseable", () => {
    expect(extractAge()).toBeUndefined();
    expect(extractAge("", null, undefined)).toBeUndefined();
    expect(extractAge("Un contexte sans âge lisible")).toBeUndefined();
  });

  it("prefers the first parseable source (JSON age > description fallback)", () => {
    // Quand le champ JSON est clean, on le prend.
    expect(extractAge("47 ans", "Femme de 99 ans")).toBe(47);
    // Quand le champ JSON est flou ("Virginia a 2 ans"), on le prend aussi (il matche).
    expect(extractAge("Virginia a 2 ans", "Femme de 47 ans")).toBe(2);
  });
});
