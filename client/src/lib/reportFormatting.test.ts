import { describe, expect, it } from "vitest";
import {
  classifyStatusCell,
  stripLeadingHeadingEmojis,
  stripRedundantSections,
} from "./reportFormatting";

describe("stripRedundantSections", () => {
  it("removes the SCORE GLOBAL section until the next heading", () => {
    const input = [
      "# Rapport",
      "",
      "## SCORE GLOBAL",
      "",
      "| Section | Poids |",
      "| --- | --- |",
      "| Anamnèse | 25% |",
      "",
      "```",
      "┌────┬─────┐",
      "│ A  │ B   │",
      "└────┴─────┘",
      "```",
      "",
      "## DÉTAIL PAR SECTION",
      "",
      "Contenu à conserver.",
    ].join("\n");
    const out = stripRedundantSections(input);
    expect(out).not.toMatch(/SCORE\s+GLOBAL/i);
    expect(out).not.toMatch(/┌/);
    expect(out).toMatch(/DÉTAIL PAR SECTION/);
    expect(out).toMatch(/Contenu à conserver/);
  });

  it("removes the LÉGENDE DES STATUTS section", () => {
    const input = [
      "## LÉGENDE DES STATUTS",
      "",
      "- ✅ = OK",
      "- ⚠️ = Partiel",
      "- ❌ = Manquant",
      "",
      "## POINTS FORTS",
      "",
      "Texte conservé.",
    ].join("\n");
    const out = stripRedundantSections(input);
    expect(out).not.toMatch(/LÉGENDE/i);
    expect(out).not.toMatch(/= OK/);
    expect(out).toMatch(/POINTS FORTS/);
    expect(out).toMatch(/Texte conservé/);
  });

  it("removes both sections when both are present and preserves the rest", () => {
    const input = [
      "# Rapport",
      "",
      "## SCORE GLOBAL",
      "",
      "Score : 6%",
      "",
      "## LÉGENDE DES STATUTS",
      "",
      "- ✅ OK",
      "",
      "## DÉTAIL PAR SECTION",
      "",
      "### 1. ANAMNÈSE",
      "",
      "| # | Item | Statut | Commentaire |",
      "| --- | --- | --- | --- |",
      "| a1 | Motif | ✅ | ok |",
      "",
      "## POINTS FORTS",
      "",
      "Rien à signaler.",
    ].join("\n");
    const out = stripRedundantSections(input);
    expect(out).not.toMatch(/SCORE\s+GLOBAL/i);
    expect(out).not.toMatch(/LÉGENDE/i);
    expect(out).toMatch(/DÉTAIL PAR SECTION/);
    expect(out).toMatch(/POINTS FORTS/);
    expect(out).toMatch(/a1/);
    expect(out).toMatch(/Motif/);
  });

  it("strips inline `SCORE GLOBAL :` lines outside of headings", () => {
    const input = [
      "## DÉTAIL PAR SECTION",
      "",
      "SCORE GLOBAL : 42% — Verdict : À retravailler",
      "",
      "Reste du texte.",
    ].join("\n");
    const out = stripRedundantSections(input);
    expect(out).not.toMatch(/SCORE\s+GLOBAL\s*:/i);
    expect(out).toMatch(/Reste du texte/);
    expect(out).toMatch(/DÉTAIL PAR SECTION/);
  });

  it("leaves content untouched when no redundant section is present", () => {
    const input = "# Rapport\n\n## POINTS FORTS\n\nTexte.\n";
    expect(stripRedundantSections(input)).toBe("# Rapport\n\n## POINTS FORTS\n\nTexte.");
  });

  it("handles level-3 'Score global' subtitles too (stops at next same-level heading)", () => {
    const input = [
      "## DÉTAIL",
      "",
      "### Score global",
      "",
      "Ligne à retirer.",
      "",
      "### Autre sous-section",
      "",
      "À garder.",
    ].join("\n");
    const out = stripRedundantSections(input);
    expect(out).not.toMatch(/Score global/i);
    expect(out).not.toMatch(/Ligne à retirer/);
    expect(out).toMatch(/À garder/);
    expect(out).toMatch(/Autre sous-section/);
  });
});

describe("stripLeadingHeadingEmojis", () => {
  it("removes a single emoji at the start of an h2 title", () => {
    expect(stripLeadingHeadingEmojis("## 📊 DÉTAIL PAR SECTION")).toBe("## DÉTAIL PAR SECTION");
  });

  it("removes an emoji at the start of an h3 title (✅)", () => {
    expect(stripLeadingHeadingEmojis("### ✅ Examen")).toBe("### Examen");
  });

  it("removes an emoji at the start of an h1 title (📋)", () => {
    expect(stripLeadingHeadingEmojis("# 📋 RAPPORT")).toBe("# RAPPORT");
  });

  it("removes multiple consecutive emojis (💡 💡)", () => {
    expect(stripLeadingHeadingEmojis("## 💡 💡 CONSEILS")).toBe("## CONSEILS");
  });

  it("does not touch emojis inside body text", () => {
    expect(stripLeadingHeadingEmojis("Texte 📊 inline")).toBe("Texte 📊 inline");
  });

  it("is idempotent", () => {
    const once = stripLeadingHeadingEmojis("## 📊 DÉTAIL");
    expect(stripLeadingHeadingEmojis(once)).toBe(once);
  });

  it("preserves status symbols in table cells (not headings)", () => {
    const input = [
      "## DÉTAIL",
      "",
      "| # | Item | Statut |",
      "| --- | --- | --- |",
      "| a1 | Motif | ✅ |",
    ].join("\n");
    const out = stripLeadingHeadingEmojis(input);
    expect(out).toContain("| ✅ |");
  });

  it("is applied by stripRedundantSections", () => {
    const input = "## 📊 DÉTAIL PAR SECTION\n\nTexte.";
    expect(stripRedundantSections(input)).toBe("## DÉTAIL PAR SECTION\n\nTexte.");
  });
});

describe("classifyStatusCell", () => {
  it("detects OK / Partiel / Manquant / N/A / ?", () => {
    expect(classifyStatusCell("✅").icon).toBe("ok");
    expect(classifyStatusCell("⚠️").icon).toBe("partial");
    expect(classifyStatusCell("⚠").icon).toBe("partial");
    expect(classifyStatusCell("❌").icon).toBe("missing");
    expect(classifyStatusCell("[N/A]").icon).toBe("na");
    expect(classifyStatusCell("N/A").icon).toBe("na");
    expect(classifyStatusCell("[?]").icon).toBe("unknown");
    expect(classifyStatusCell("").icon).toBeNull();
  });
});
