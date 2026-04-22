import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AccentedMarkdown } from "./AccentedMarkdown";
import { tokenizeAccents } from "@/lib/reportAccents";

afterEach(cleanup);

describe("tokenizeAccents", () => {
  it("accents 'Problème :', 'Action concrète :' and 'Bénéfice :'", () => {
    const tokens = tokenizeAccents("Problème : X. Action concrète : Y. Bénéfice : Z.");
    const accented = tokens.filter((t) => t.accent !== null);
    const kinds = accented.map((t) => t.accent);
    expect(kinds).toContain("problem");
    expect(kinds).toContain("action");
    expect(kinds).toContain("benefit");
    expect(accented.some((t) => /Problème/i.test(t.text))).toBe(true);
    expect(accented.some((t) => /Action concrète/i.test(t.text))).toBe(true);
  });

  it("accents mnemonics, percents and fractions", () => {
    const tokens = tokenizeAccents("SOCRATES couvert à 75% soit 6/8.");
    const kinds = tokens.filter((t) => t.accent).map((t) => t.accent);
    expect(kinds).toContain("mnemonic");
    expect(kinds).toContain("percent");
    expect(kinds).toContain("fraction");
  });

  it("does not duplicate or lose characters", () => {
    const original = "Problème : manque SOCRATES dans 3/8 items (37%).";
    const tokens = tokenizeAccents(original);
    const rebuilt = tokens.map((t) => t.text).join("");
    expect(rebuilt).toBe(original);
  });

  it("prefers 'Action concrète :' over the shorter 'Action :'", () => {
    const tokens = tokenizeAccents("Action concrète : faire X.");
    const accented = tokens.filter((t) => t.accent === "action");
    expect(accented).toHaveLength(1);
    expect(accented[0].text).toMatch(/Action concrète/i);
  });
});

describe("AccentedMarkdown", () => {
  it("renders 'Problème :' in red-700 and 'SOCRATES' as an indigo mnemonic", () => {
    const { container } = render(
      <AccentedMarkdown>{"Problème : manque SOCRATES."}</AccentedMarkdown>,
    );
    const html = container.innerHTML;
    expect(html).toMatch(/text-red-700/);
    expect(html).toMatch(/Problème/);
    expect(html).toMatch(/text-indigo-700/);
    expect(html).toMatch(/SOCRATES/);
    // Pas de doublon : le texte complet ne doit apparaître qu'une fois.
    const occurrences = (container.textContent ?? "").match(/Problème/g)?.length ?? 0;
    expect(occurrences).toBe(1);
  });

  it("renders a markdown table with Tailwind classes (no ASCII monospace)", () => {
    const md = [
      "| # | Item | Statut | Commentaire |",
      "| --- | --- | --- | --- |",
      "| a1 | Motif | ✅ | ok |",
    ].join("\n");
    const { container } = render(<AccentedMarkdown>{md}</AccentedMarkdown>);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.className).toMatch(/border-collapse/);
  });

  it("renders the Statut column as a colored badge (green for ✅)", () => {
    const md = [
      "| # | Item | Statut |",
      "| --- | --- | --- |",
      "| a1 | Motif | ✅ |",
    ].join("\n");
    const { container } = render(<AccentedMarkdown>{md}</AccentedMarkdown>);
    const html = container.innerHTML;
    expect(html).toMatch(/text-emerald-800/);
  });

  it("renders h2 with primary color, uppercase and bottom border", () => {
    const { container } = render(<AccentedMarkdown>{"## POINTS FORTS\n\nTexte."}</AccentedMarkdown>);
    const h2 = container.querySelector("h2");
    expect(h2).not.toBeNull();
    expect(h2!.className).toMatch(/text-primary/);
    expect(h2!.className).toMatch(/uppercase/);
    expect(h2!.className).toMatch(/border-primary\/20/);
  });

  it("does not colorize content inside code blocks", () => {
    const md = "```\nProblème : inside code\n```";
    const { container } = render(<AccentedMarkdown>{md}</AccentedMarkdown>);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.innerHTML).not.toMatch(/text-red-700/);
  });
});
