import { describe, expect, it } from "vitest";
import { tokenizeAccents } from "./reportAccents";

function matched(text: string) {
  return tokenizeAccents(text)
    .filter((t) => t.accent !== null)
    .map((t) => ({ text: t.text, accent: t.accent }));
}

describe("tokenizeAccents — label coverage", () => {
  it("problem variants: Problème / Problemes / Critical miss", () => {
    expect(matched("Problème : X")[0].accent).toBe("problem");
    expect(matched("Problèmes : X")[0].accent).toBe("problem");
    expect(matched("Critical miss : foo")[0].accent).toBe("problem");
  });

  it("problem variants: Éléments critiques manqués / variants", () => {
    expect(matched("Éléments critiques manqués : red flag")[0].accent).toBe("problem");
    expect(matched("Elements critiques manques : foo")[0].accent).toBe("problem");
    expect(matched("Élément critique manqué : foo")[0].accent).toBe("problem");
  });

  it("problem variants: Points à améliorer (with or without trailing modifier)", () => {
    expect(matched("Points à améliorer :")[0].accent).toBe("problem");
    expect(matched("Points à améliorer avec impact clinique :")[0].accent).toBe("problem");
    expect(matched("Point a ameliorer :")[0].accent).toBe("problem");
  });

  it("problem variants: Axes d'amélioration (straight and curly apostrophe)", () => {
    expect(matched("Axes d'amélioration :")[0].accent).toBe("problem");
    expect(matched("Axes d’amélioration :")[0].accent).toBe("problem");
    expect(matched("Axe d'amelioration :")[0].accent).toBe("problem");
  });

  it("action variants: Action / Action concrète / Technique / Recommandation", () => {
    // "Action concrète" doit l'emporter sur "Action" générique.
    const full = tokenizeAccents("Action concrète : faire X")
      .filter((t) => t.accent === "action");
    expect(full).toHaveLength(1);
    expect(full[0].text).toMatch(/Action concrète/i);

    expect(matched("Action : foo")[0].accent).toBe("action");
    expect(matched("Technique : foo")[0].accent).toBe("action");
    expect(matched("Recommandation : foo")[0].accent).toBe("action");
  });

  it("benefit variants: Bénéfice / Bénéfice attendu / Points forts", () => {
    expect(matched("Bénéfice : gain")[0].accent).toBe("benefit");
    expect(matched("Bénéfice attendu : gain")[0].accent).toBe("benefit");
    expect(matched("Benefices attendus : gain")[0].accent).toBe("benefit");
    expect(matched("Points forts : ok")[0].accent).toBe("benefit");
    expect(matched("Point fort : ok")[0].accent).toBe("benefit");
  });

  it("covered / missing variants", () => {
    expect(matched("Éléments couverts : a, b")[0].accent).toBe("covered");
    expect(matched("Element couvert : a")[0].accent).toBe("covered");
    expect(matched("Manquants : c, d")[0].accent).toBe("missing");
    expect(matched("Manquant : c")[0].accent).toBe("missing");
  });

  it("mnemonics, percents and fractions", () => {
    const kinds = tokenizeAccents("SOCRATES couvert à 75% soit 6/8.")
      .filter((t) => t.accent)
      .map((t) => t.accent);
    expect(kinds).toContain("mnemonic");
    expect(kinds).toContain("percent");
    expect(kinds).toContain("fraction");
  });

  it("does not duplicate or lose characters (round-trip preservation)", () => {
    const samples = [
      "Problème : manque SOCRATES dans 3/8 items (37%).",
      "Points forts : empathie. Points à améliorer : irradiation.",
      "Action concrète : faire. Bénéfice attendu : gain.",
      "Éléments critiques manqués : red flag SCA; Action : ECG.",
    ];
    for (const s of samples) {
      const rebuilt = tokenizeAccents(s).map((t) => t.text).join("");
      expect(rebuilt).toBe(s);
    }
  });
});
