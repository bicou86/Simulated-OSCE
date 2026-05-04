// Phase 11 J2 — tests du slugifier pédagogique (déterministe).
//
// Couvre les 10 cas tabulaires du livrable J1 §3.2 (slug, basename, url),
// l'idempotence (slugify(slugify(x)) === slugify(x)) sur tous les cas, et
// un cas limite « nom déjà slugifié reste inchangé ». Aucun test ne fait
// d'I/O — c'est un module pur, déterministe, sans dépendance externe.

import { describe, expect, it } from "vitest";
import {
  slugifyPedagogicalImageName,
  type SlugifyResult,
} from "@shared/pedagogical-image-slug";

interface SlugCase {
  input: string;
  slug: string;
}

// Les 10 cas de référence (J1 §3.2). Chaque cas exerce une combinaison
// de transformations : accents, espaces, underscores, mixed-case,
// ponctuation médicale (D1-D6, GCS, T2-FLAIR), hyphens, virgules,
// préfixes Œ/œ, deux-points, parenthèses implicites.
const CASES: SlugCase[] = [
  { input: "Échographie abdominale", slug: "echographie-abdominale" },
  { input: "Radiographie thorax PA", slug: "radiographie-thorax-pa" },
  { input: "Test d'Allen positif", slug: "test-d-allen-positif" },
  { input: "ECG STEMI antérieur D1-D6", slug: "ecg-stemi-anterieur-d1-d6" },
  { input: "Plaie suturée — face dorsale", slug: "plaie-suturee-face-dorsale" },
  { input: "Lésion cutanée_érythémateuse", slug: "lesion-cutanee-erythemateuse" },
  { input: "Dermatoscopie : naevus atypique", slug: "dermatoscopie-naevus-atypique" },
  { input: "IRM crânienne T2-FLAIR", slug: "irm-cranienne-t2-flair" },
  { input: "Œdème pulmonaire aigu cardiogénique", slug: "oedeme-pulmonaire-aigu-cardiogenique" },
  { input: "Score de Glasgow GCS", slug: "score-de-glasgow-gcs" },
];

describe("Phase 11 J2 — slugifyPedagogicalImageName : 10 cas tabulaires (J1 §3.2)", () => {
  it.each(CASES)("« $input » → slug « $slug »", ({ input, slug }) => {
    const result = slugifyPedagogicalImageName(input);
    expect(result.slug).toBe(slug);
    expect(result.basename).toBe(`${slug}.jpg`);
    expect(result.url).toBe(`/pedagogical-images/${slug}.jpg`);
  });
});

describe("Phase 11 J2 — slugifyPedagogicalImageName : idempotence", () => {
  it("slugify(slugify(x)) === slugify(x) pour les 10 cas de référence", () => {
    for (const c of CASES) {
      const once: SlugifyResult = slugifyPedagogicalImageName(c.input);
      const twice: SlugifyResult = slugifyPedagogicalImageName(once.basename);
      const thrice: SlugifyResult = slugifyPedagogicalImageName(twice.basename);
      expect(once).toEqual(twice);
      expect(twice).toEqual(thrice);
    }
  });
});

describe("Phase 11 J2 — slugifyPedagogicalImageName : cas limite", () => {
  it("nom déjà slugifié reste inchangé (basename, url, slug)", () => {
    const result = slugifyPedagogicalImageName("echographie-abdominale.jpg");
    expect(result.slug).toBe("echographie-abdominale");
    expect(result.basename).toBe("echographie-abdominale.jpg");
    expect(result.url).toBe("/pedagogical-images/echographie-abdominale.jpg");
  });
});
