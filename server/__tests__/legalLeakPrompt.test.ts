// Phase 5 J3 — verrouillage du prompt patient/accompagnant pour les
// stations portant un legalContext.
//
// Pour chacun des 3 pilotes Phase 5 (AMBOSS-24, USMLE-34, RESCOS-72),
// on vérifie sur le VRAI catalogue (initCatalog) et le VRAI
// buildSystemPrompt que :
//
//   1. La directive "## CADRE JURIDIQUE — INTERDICTIONS STRICTES" EST
//      injectée (le LLM a la consigne explicite).
//   2. Le garde-fou sémantique EST présent (les 2 phrases-clés).
//   3. Le RESTE du prompt (hors directive) ne contient AUCUN des codes
//      `applicable_law` ni des concepts juridiques transversaux. Les
//      regex utilisés sont les mêmes que celles consommées en J2 par
//      l'évaluateur — on ferme la boucle entre détection et injection.
//   4. Pour les stations SANS legalContext (mono-patient legacy +
//      multi-profils Phase 4 sans qualification médico-légale), la
//      directive n'est PAS injectée — pas de pollution prompt sur les
//      285+ stations historiques.

import { beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { initCatalog } from "../services/stationsService";
import { buildSystemPrompt } from "../services/patientService";
import {
  buildLegalLeakDirective,
  LEGAL_BLACKLIST_TERMS,
  LEGAL_LAW_CODE_PATTERNS,
} from "../lib/legalLexicon";
import { getStationParticipants } from "@shared/station-schema";

const PATIENT_DIR = path.resolve(__dirname, "..", "data", "patient");
const DIRECTIVE_MARKER = "## CADRE JURIDIQUE — INTERDICTIONS STRICTES";

async function loadStationRaw(file: string, shortId: string): Promise<any> {
  const raw = await fs.readFile(path.join(PATIENT_DIR, file), "utf-8");
  const parsed = JSON.parse(raw) as { stations: Array<{ id: string }> };
  return parsed.stations.find((s) => s.id.startsWith(shortId + " "));
}

beforeAll(async () => {
  await initCatalog();
});

interface LegalPilot {
  shortId: string;
  file: string;
}
const PILOTS: LegalPilot[] = [
  { shortId: "AMBOSS-24", file: "Patient_AMBOSS_2.json" },
  { shortId: "USMLE-34", file: "Patient_USMLE_2.json" },
  { shortId: "RESCOS-72", file: "Patient_RESCOS_4.json" },
];

// Retire la directive complète du prompt pour pouvoir asserter
// l'absence des termes juridiques DANS LE RESTE du prompt. La
// directive contient les termes BY DESIGN — c'est sa raison d'être.
function stripLegalDirective(prompt: string, applicable_law: string[]): string {
  const directive = buildLegalLeakDirective(applicable_law);
  // La directive est un bloc délimité ; replace exact suffit.
  return prompt.replace(directive, "");
}

describe("Phase 5 J3 — directive de cloisonnement médico-légal injectée", () => {
  it.each(PILOTS)(
    "$shortId : la directive « CADRE JURIDIQUE » est injectée dans le prompt",
    async ({ shortId }) => {
      const prompt = await buildSystemPrompt(shortId, "text");
      expect(prompt).toContain(DIRECTIVE_MARKER);
    },
  );

  it.each(PILOTS)(
    "$shortId : le garde-fou sémantique (réagir émotionnellement / ne jamais confirmer) est injecté",
    async ({ shortId }) => {
      const prompt = await buildSystemPrompt(shortId, "text");
      expect(prompt).toMatch(/r[ée]agir\s+[ée]motionnellement/i);
      expect(prompt).toMatch(/CONFIRMES?\s+(?:JAMAIS|PAS)/i);
      expect(prompt).toMatch(/c['’]est\s+vous\s+le\s+m[ée]decin/i);
    },
  );

  it.each(PILOTS)(
    "$shortId : la blacklist liste les codes spécifiques de la station (humanLabel)",
    async ({ shortId, file }) => {
      const station = await loadStationRaw(file, shortId);
      const codes: string[] = station.legalContext.applicable_law;
      const prompt = await buildSystemPrompt(shortId, "text");
      for (const code of codes) {
        const spec = LEGAL_LAW_CODE_PATTERNS[code];
        expect(spec, `code non mappé : ${code}`).toBeDefined();
        // Le humanLabel doit apparaître textuellement dans la directive.
        expect(prompt).toContain(spec!.humanLabel);
      }
    },
  );

  it.each(PILOTS)(
    "$shortId : la blacklist générique liste les concepts transversaux",
    async ({ shortId }) => {
      const prompt = await buildSystemPrompt(shortId, "text");
      for (const t of LEGAL_BLACKLIST_TERMS) {
        expect(prompt).toContain(t.term);
      }
    },
  );
});

describe("Phase 5 J3 — pas de leak juridique HORS directive", () => {
  it.each(PILOTS)(
    "$shortId : aucun pattern de detectPatterns des codes applicable_law ne fuit hors de la directive",
    async ({ shortId, file }) => {
      const station = await loadStationRaw(file, shortId);
      const codes: string[] = station.legalContext.applicable_law;
      const prompt = await buildSystemPrompt(shortId, "text");
      const rest = stripLegalDirective(prompt, codes);
      // La directive doit avoir été soustraite — sinon le test serait aveugle.
      expect(rest).not.toContain(DIRECTIVE_MARKER);

      const leaks: string[] = [];
      for (const code of codes) {
        const spec = LEGAL_LAW_CODE_PATTERNS[code];
        if (!spec) continue;
        for (const re of spec.detectPatterns) {
          if (re.test(rest)) {
            leaks.push(`${code} (${re.source})`);
          }
        }
      }
      expect(
        leaks,
        `${shortId} : codes leakés hors directive : ${leaks.join(" ; ")}`,
      ).toEqual([]);
    },
  );

  // Note : on ne teste PAS la non-fuite des LEGAL_BLACKLIST_TERMS
  // génériques (« secret professionnel », « certificat de complaisance »,
  // « APEA », …) hors directive. Raison : ces termes peuvent
  // légitimement apparaître dans le narrative substrat de la station
  // (consignes_jeu, motif_cache, description) — le LLM en a besoin
  // pour incarner le rôle. La blacklist est une INSTRUCTION (« ne cite
  // pas spontanément ces termes ») injectée via la directive ; le test
  // de non-leak strict porte sur les CODES DE LOI (qui n'ont aucune
  // raison narrative d'apparaître) et sur les items du legalContext
  // (decision_rationale, must_verbalize/avoid, red_flags).

  it.each(PILOTS)(
    "$shortId : aucun item de candidate_must_verbalize / must_avoid / red_flags / decision_rationale n'apparaît dans le prompt",
    async ({ shortId, file }) => {
      const station = await loadStationRaw(file, shortId);
      const ctx = station.legalContext;
      const prompt = await buildSystemPrompt(shortId, "text");
      // decision_rationale est la quintessence de la fuite (cite tous les
      // articles + la décision attendue).
      expect(prompt).not.toContain(ctx.decision_rationale);
      // Chaque item must_verbalize/must_avoid/red_flag est une phrase
      // canonique de la fixture — leur présence dans le prompt serait
      // le signe que META_FIELDS_TO_STRIP a un trou.
      for (const v of [
        ...ctx.candidate_must_verbalize,
        ...ctx.candidate_must_avoid,
        ...ctx.red_flags,
      ]) {
        expect(prompt, `« ${v} » a fui dans le prompt ${shortId}`).not.toContain(v);
      }
    },
  );
});

describe("Phase 5 J3 — non-régression : stations SANS legalContext", () => {
  // Sélection : un mono-patient (RESCOS-1, AMBOSS-1, RESCOS-7), un
  // pédiatrique (RESCOS-9b), un multi-profils Phase 4 (RESCOS-70).
  const NO_LEGAL: { shortId: string; file: string }[] = [
    { shortId: "RESCOS-1", file: "Patient_RESCOS_1.json" },
    { shortId: "AMBOSS-1", file: "Patient_AMBOSS_1.json" },
    { shortId: "RESCOS-9b", file: "Patient_RESCOS_1.json" },
    { shortId: "RESCOS-70", file: "Patient_RESCOS_4.json" },
  ];

  it.each(NO_LEGAL)(
    "$shortId : la directive « CADRE JURIDIQUE » N'EST PAS injectée",
    async ({ shortId }) => {
      const prompt = await buildSystemPrompt(shortId, "text");
      expect(prompt).not.toContain(DIRECTIVE_MARKER);
    },
  );

  it("RESCOS-70 multi-profils : prompt Emma + prompt mère NE contiennent PAS la directive", async () => {
    const station = await loadStationRaw("Patient_RESCOS_4.json", "RESCOS-70");
    const participants = getStationParticipants(station);
    const emma = participants.find((p) => p.id === "emma")!;
    const mother = participants.find((p) => p.id === "mother")!;
    const promptEmma = await buildSystemPrompt(
      "RESCOS-70",
      "text",
      emma,
      participants,
    );
    const promptMother = await buildSystemPrompt(
      "RESCOS-70",
      "text",
      mother,
      participants,
    );
    expect(promptEmma).not.toContain(DIRECTIVE_MARKER);
    expect(promptMother).not.toContain(DIRECTIVE_MARKER);
  });

  it("AMBOSS-1 (mono-patient sans legalContext) : prompt strictement identique avec/sans appel multiple", async () => {
    // Garantit la stabilité (idempotence) du prompt sur une station
    // sans qualification médico-légale.
    const p1 = await buildSystemPrompt("AMBOSS-1", "text");
    const p2 = await buildSystemPrompt("AMBOSS-1", "text");
    expect(p1).toBe(p2);
    // Et bien sûr aucune trace de la directive.
    expect(p1).not.toContain(DIRECTIVE_MARKER);
    expect(p1).not.toContain("CADRE JURIDIQUE");
  });
});
