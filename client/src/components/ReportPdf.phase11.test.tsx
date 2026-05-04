// Phase 11 J4 — tests du composant <ReportPdf> sur les 4 sections
// pédagogiques additives. Le composant utilise @react-pdf/renderer dont
// les primitives (Document/Page/View/Text/Image) ne rendent pas
// nativement dans happy-dom. Stratégie : on mock chacune des primitives
// pour qu'elle se substitue à un div/span/img standard en transmettant
// les `style` et `props` métier sur des `data-*` attributes. Ça permet
// d'utiliser @testing-library/react pour interroger l'arbre rendu sans
// jamais déclencher la logique d'export PDF.
//
// Couvre :
//   1. Fallback gracieux (pas de prop pedagogicalContent) → AUCUN
//      bandeau pédagogique rendu (PDF byte-identique pré-Phase-11)
//   2. pedagogicalContent={null} explicite → idem fallback
//   3. Section Synthèse rendue : titre racine + sous-section présents
//   4. Récursivité 3 niveaux : paddingLeft croissant 0/12/24
//   5. Bloc Iconographie rendu : 3 <Image> + légendes
//   6. Cap profondeur : 5 niveaux d'imbrication → 4 niveaux normaux,
//      5e niveau rendu en mode aplati (concaténation textuelle)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import React from "react";

// Mock @react-pdf/renderer AVANT l'import de ReportPdf. Les primitives
// deviennent des éléments HTML standard pour permettre le rendu happy-dom.
// On utilise `React.createElement` pour produire de vrais éléments React
// 19 compatibles (le retour d'objet littéral déclenche un invariant
// `older version of React was rendered`).
vi.mock("@react-pdf/renderer", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const passthrough = (tag: string) => (props: any) => {
    const { children, style, src, break: doBreak, wrap, fixed, render: _r, ...rest } = props ?? {};
    const serializedStyle = style
      ? Array.isArray(style)
        ? JSON.stringify(Object.assign({}, ...style))
        : JSON.stringify(style)
      : undefined;
    const finalProps: Record<string, unknown> = { ...rest };
    if (serializedStyle) finalProps["data-style"] = serializedStyle;
    if (doBreak) finalProps["data-break"] = "true";
    if (wrap === false) finalProps["data-wrap"] = "false";
    if (fixed) finalProps["data-fixed"] = "true";
    if (src) {
      finalProps["data-src"] = src;
      finalProps["src"] = src;
    }
    return React.createElement(tag, finalProps, children);
  };
  return {
    Document: passthrough("section"),
    Page: passthrough("article"),
    View: passthrough("div"),
    Text: passthrough("span"),
    Image: passthrough("img"),
    StyleSheet: { create: <T,>(s: T) => s },
    Font: { register: () => {} },
    pdf: () => ({ toBlob: async () => new Blob() }),
  };
});

import { ReportPdf, type ReportPdfProps } from "./ReportPdf";
import type { PedagogicalContent } from "@shared/pedagogical-content-schema";

// Props minimales communes à tous les tests. Couvre exactement les 5
// champs canoniques pré-Phase-11 (pas de pedagogicalContent par défaut).
const baseProps: Omit<ReportPdfProps, "pedagogicalContent"> = {
  scores: {
    globalScore: 70,
    sections: [
      { key: "anamnese", name: "Anamnèse", weight: 0.25, score: 70 },
      { key: "examen", name: "Examen", weight: 0.25, score: 70 },
      { key: "management", name: "Management", weight: 0.25, score: 70 },
      { key: "cloture", name: "Clôture", weight: 0.25, score: 70 },
      { key: "communication", name: "Communication", weight: 0, score: 0 },
    ],
    verdict: "Réussi",
  },
  markdown: "# Rapport\n\nContenu test.",
  stationId: "TEST-1",
  stationTitle: "Station test",
  generatedAt: new Date("2026-05-04T12:00:00Z"),
};

afterEach(() => cleanup());

describe("Phase 11 J4 — ReportPdf : fallback gracieux pré-Phase-11", () => {
  it("sans prop pedagogicalContent → aucune section pédagogique rendue", () => {
    const { container } = render(<ReportPdf {...baseProps} />);
    const html = container.innerHTML;
    // Aucun bandeau pédagogique ne doit apparaître.
    expect(html).not.toContain("Synthèse pédagogique");
    expect(html).not.toContain("Présentation systématisée");
    expect(html).not.toContain("Théorie pratique");
    expect(html).not.toContain("Iconographie pédagogique");
  });

  it("pedagogicalContent={null} explicite → idem fallback (aucun bandeau)", () => {
    const { container } = render(<ReportPdf {...baseProps} pedagogicalContent={null} />);
    const html = container.innerHTML;
    expect(html).not.toContain("Synthèse pédagogique");
    expect(html).not.toContain("Présentation systématisée");
    expect(html).not.toContain("Théorie pratique");
    expect(html).not.toContain("Iconographie pédagogique");
    // Aucun saut de page additionnel non plus.
    expect(container.querySelectorAll("[data-break]").length).toBe(0);
  });
});

describe("Phase 11 J4 — ReportPdf : sections pédagogiques rendues", () => {
  it("Synthèse pédagogique : titre racine + sous-section présents", () => {
    const pedagogicalContent: PedagogicalContent = {
      resume: {
        titre: "Titre racine résumé",
        sections: [
          { titre: "Sous-section 1", contenu: "Contenu sous-section 1" },
        ],
      },
    };
    const { container } = render(
      <ReportPdf {...baseProps} pedagogicalContent={pedagogicalContent} />,
    );
    const html = container.innerHTML;
    expect(html).toContain("Titre racine résumé");
    expect(html).toContain("Sous-section 1");
    expect(html).toContain("Contenu sous-section 1");
  });

  it("récursivité 3 niveaux : paddingLeft croissant 0 / 12 / 24", () => {
    const pedagogicalContent: PedagogicalContent = {
      resume: {
        titre: "Racine",
        sections: [
          {
            titre: "Niveau 0",
            subsections: [
              {
                titre: "Niveau 1",
                subsections: [
                  { titre: "Niveau 2", contenu: "Contenu niveau 2" },
                ],
              },
            ],
          },
        ],
      },
    };
    const { container } = render(
      <ReportPdf {...baseProps} pedagogicalContent={pedagogicalContent} />,
    );
    const divs = container.querySelectorAll("div[data-style]");
    const paddings = Array.from(divs)
      .map((d) => {
        const style = d.getAttribute("data-style");
        if (!style) return null;
        try {
          const parsed = JSON.parse(style) as { paddingLeft?: number };
          return typeof parsed.paddingLeft === "number" ? parsed.paddingLeft : null;
        } catch {
          return null;
        }
      })
      .filter((v): v is number => v !== null);
    // On doit retrouver au moins 0, 12, 24 dans l'arbre rendu.
    expect(paddings).toContain(0);
    expect(paddings).toContain(12);
    expect(paddings).toContain(24);
  });

  it("bloc Iconographie : 3 <Image> rendues avec src + légendes", () => {
    const pedagogicalContent: PedagogicalContent = {
      images: [
        {
          data: "/pedagogical-images/test-img1.jpg",
          title: "Titre image 1",
          description: "Description longue image 1",
        },
        {
          data: "/pedagogical-images/test-img2.jpg",
          title: "Titre image 2",
          description: "Description longue image 2",
        },
        {
          data: "/pedagogical-images/test-img3.jpg",
          title: "Titre image 3",
          description: "Description longue image 3",
        },
      ],
    };
    const { container } = render(
      <ReportPdf {...baseProps} pedagogicalContent={pedagogicalContent} />,
    );
    const images = container.querySelectorAll("img[data-src]");
    expect(images.length).toBe(3);
    const srcs = Array.from(images).map((i) => i.getAttribute("data-src"));
    expect(srcs).toContain("/pedagogical-images/test-img1.jpg");
    expect(srcs).toContain("/pedagogical-images/test-img2.jpg");
    expect(srcs).toContain("/pedagogical-images/test-img3.jpg");
    // Le bandeau "Iconographie pédagogique" doit être présent.
    expect(container.innerHTML).toContain("Iconographie pédagogique");
    // Les titres et descriptions des cartes aussi.
    expect(container.innerHTML).toContain("Titre image 1");
    expect(container.innerHTML).toContain("Description longue image 2");
  });

  it("cap profondeur : 5 niveaux → 4 niveaux normaux, 5e aplati en texte", () => {
    // Construit une arborescence 5 niveaux profonde. Le 5e niveau (depth=4
    // depuis sections[0]) doit déclencher le mode aplati (PEDAGOGY_DEPTH_CAP).
    const pedagogicalContent: PedagogicalContent = {
      resume: {
        titre: "Racine cap",
        sections: [
          {
            titre: "Niveau 0",
            subsections: [
              {
                titre: "Niveau 1",
                subsections: [
                  {
                    titre: "Niveau 2",
                    subsections: [
                      {
                        titre: "Niveau 3",
                        subsections: [
                          {
                            // Niveau 4 = depth=4 = au cap → mode aplati.
                            titre: "Niveau 4 cap",
                            contenu: "Contenu niveau 4 cap",
                            points: ["Point A niveau 4", "Point B niveau 4"],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const { container } = render(
      <ReportPdf {...baseProps} pedagogicalContent={pedagogicalContent} />,
    );
    const html = container.innerHTML;
    // Le contenu aplati du niveau 4 doit contenir titre + contenu + points
    // joints par un séparateur (cf. flattenSubsection).
    expect(html).toContain("Niveau 4 cap");
    expect(html).toContain("Contenu niveau 4 cap");
    expect(html).toContain("Point A niveau 4");
    // Le paddingLeft du bloc aplati doit être >= 48 (depth * 12 ≥ 4*12).
    const divs = container.querySelectorAll("div[data-style]");
    const paddings = Array.from(divs)
      .map((d) => {
        const style = d.getAttribute("data-style");
        if (!style) return null;
        try {
          const parsed = JSON.parse(style) as { paddingLeft?: number };
          return typeof parsed.paddingLeft === "number" ? parsed.paddingLeft : null;
        } catch {
          return null;
        }
      })
      .filter((v): v is number => v !== null);
    expect(paddings.some((p) => p >= 48)).toBe(true);
  });
});
