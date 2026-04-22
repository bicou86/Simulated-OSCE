// Tests de l'extracteur de sexe à partir de `patient_description`.
// Couvre les patterns présents dans le corpus réel des 570 stations (femme/homme,
// fillette/garçon, nourrisson, consultante/consultant, présentée/présenté).

import { beforeEach, describe, expect, it } from "vitest";
import { extractSex, resetSexCache } from "../lib/patientSex";

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
