// Non-régression score-à-score sur la pipeline d'évaluation Phase 2.
// 4 fixtures figées en JSON sous `tests/fixtures/transcripts/` — chacune
// contient un transcript réaliste + la réponse MOCKÉE que Sonnet est supposé
// produire + les invariants à vérifier (stationType, communicationWeight,
// globalScore). Les fixtures sont gelées au commit 57a0f90 ; toute
// modification future de ce fichier ou du pipeline doit produire les mêmes
// valeurs avec tolérance 0 point.
//
// On mocke uniquement Anthropic (pas d'appel réseau). Le catalogue
// stationsService + le fichier evaluator JSON sont les vrais.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import path from "path";

vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: vi.fn() } };
    audio = { transcriptions: { create: vi.fn() }, speech: { create: vi.fn() } };
    models = { list: vi.fn() };
    constructor(_opts: unknown) {}
  }
  return { default: OpenAI, toFile: vi.fn() };
});

const { anthropicMessagesCreate, lastUserMessage } = vi.hoisted(() => ({
  anthropicMessagesCreate: vi.fn(),
  lastUserMessage: { value: "" as string },
}));

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    messages = { create: anthropicMessagesCreate };
    constructor(_opts: unknown) {}
  }
  return { default: Anthropic };
});

vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(async () => {}),
  getOpenAIKey: () => "sk-test",
  getAnthropicKey: () => "sk-ant-test",
  setKeys: vi.fn(async () => {}),
  isConfigured: () => true,
}));

import { initCatalog } from "../services/stationsService";
import { runEvaluation } from "../services/evaluatorService";

interface Fixture {
  _meta: { description: string; frozenAt: string; gitCommitAtFreeze: string };
  stationId: string;
  expectedStationType: string;
  expectedCommunicationWeight: number;
  expectedCanonicalWeights: {
    anamnese: number; examen: number; management: number; cloture: number; communication: number;
    [key: string]: number;
  };
  transcript: Array<{ role: "doctor" | "patient"; text: string }>;
  mockedSonnet: {
    markdown: string;
    scores: {
      globalScore: number;
      sections: Array<{ key: string; name: string; weight: number; score: number; raw?: string }>;
      verdict: "Réussi" | "À retravailler" | "Échec";
    };
  };
  expectedGlobalScore: number;
  expectedComputedFromWeights: { formula: string; calc: string; value: number };
}

const FIXTURES_DIR = path.resolve(__dirname, "..", "..", "tests", "fixtures", "transcripts");

async function loadFixture(filename: string): Promise<Fixture> {
  const raw = await fs.readFile(path.join(FIXTURES_DIR, filename), "utf-8");
  return JSON.parse(raw) as Fixture;
}

// Construit une réponse Anthropic plausible à partir de la fixture : contenu
// markdown + bloc <scores_json>. C'est ce que le mock retourne pour chaque
// station, mimant le contrat de sortie duale du prompt évaluateur.
function buildMockedAnthropicResponse(fx: Fixture) {
  const scoresJson = JSON.stringify(fx.mockedSonnet.scores, null, 2);
  const fullText =
    `${fx.mockedSonnet.markdown}\n\n<scores_json>\n${scoresJson}\n</scores_json>`;
  return {
    content: [{ type: "text", text: fullText }],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

beforeAll(async () => {
  await initCatalog();
});

afterEach(() => {
  vi.clearAllMocks();
  lastUserMessage.value = "";
});

const FIXTURE_FILES = [
  "AMBOSS-1.anamnese_examen.json",
  "AMBOSS-3.anamnese_examen.json",
  "USMLE-1.anamnese_examen.json",
  "AMBOSS-7.teleconsultation.json",
  // Phase 3 / J1-pilots — 4 témoins supplémentaires (un par station_type non
  // couvert en Phase 2 : anamnese_examen alternatif, psy, bbn,
  // pediatrie_accompagnant). Le but est de verrouiller score-à-score
  // tolérance 0 après l'ajout du support images. Les fixtures elles-mêmes
  // ne portent pas d'image ; elles vérifient que la pipeline d'évaluation
  // est strictement identique à Phase 2 sur des stations déjà existantes.
  "German-2.anamnese_examen.json",
  "German-4.psy.json",
  "RESCOS-7.bbn.json",
  "RESCOS-9b.pediatrie_accompagnant.json",
];

describe("J4 non-régression — pipeline d'évaluation par fixture", () => {
  for (const file of FIXTURE_FILES) {
    it(`${file} — stationType, communicationWeight, scores reproduits à l'identique`, async () => {
      const fx = await loadFixture(file);

      // Mock : Anthropic renvoie TOUJOURS la réponse gelée de la fixture,
      // quelle que soit la requête. On capture le user message pour vérifier
      // ensuite que la pipeline a bien injecté le bloc PHASE 2.
      anthropicMessagesCreate.mockImplementationOnce(async (args: any) => {
        lastUserMessage.value = args.messages?.[0]?.content ?? "";
        return buildMockedAnthropicResponse(fx);
      });

      const result = await runEvaluation({
        stationId: fx.stationId,
        transcript: fx.transcript,
      });

      // 1) Classification : la station doit tomber sur le station_type figé.
      expect(result.stationType, `station_type de ${fx.stationId}`).toBe(fx.expectedStationType);
      // 2) Poids Communication cohérent avec la table Phase 2.
      expect(result.communicationWeight, `communicationWeight de ${fx.stationId}`).toBe(
        fx.expectedCommunicationWeight,
      );
      // 3) Score global : RECALCULÉ serveur-side à partir des scores Sonnet
      //    et des poids canoniques (depuis bug B hotfix). La valeur
      //    expectedGlobalScore de la fixture encode cette formule canonique,
      //    pas la valeur que Sonnet renvoie — ce qui est exactement l'effet
      //    voulu : le poids Phase 2 domine, l'hallucination LLM est neutralisée.
      expect(result.scores.globalScore, `globalScore de ${fx.stationId}`).toBe(
        fx.expectedGlobalScore,
      );
      // 4) Les 5 axes canoniques sont TOUS présents dans sections, dans
      //    l'ordre anamnese > examen > management > cloture > communication.
      //    Les weights sont ceux de la table Phase 2 (en fraction, pas en %).
      expect(result.scores.sections.map((s) => s.key)).toEqual([
        "anamnese", "examen", "management", "cloture", "communication",
      ]);
      for (const s of result.scores.sections) {
        const expectedWeightFraction = fx.expectedCanonicalWeights[s.key] / 100;
        expect(s.weight, `weight de ${s.key} sur ${fx.stationId}`).toBeCloseTo(
          expectedWeightFraction, 5,
        );
        // Le score doit venir de la mocked Sonnet output (par key)
        const mockedSection = fx.mockedSonnet.scores.sections.find((m) => m.key === s.key);
        if (mockedSection) {
          expect(s.score, `score de ${s.key} sur ${fx.stationId}`).toBe(mockedSection.score);
        }
      }
      // 5) Verdict identique (non affecté par l'override des weights).
      expect(result.scores.verdict).toBe(fx.mockedSonnet.scores.verdict);
    });
  }

  it("injecte le bloc PHASE 2 avec station_type et poids Communication dans le user message", async () => {
    const fx = await loadFixture("AMBOSS-7.teleconsultation.json");
    anthropicMessagesCreate.mockImplementationOnce(async (args: any) => {
      lastUserMessage.value = args.messages?.[0]?.content ?? "";
      return buildMockedAnthropicResponse(fx);
    });
    await runEvaluation({ stationId: fx.stationId, transcript: fx.transcript });

    expect(lastUserMessage.value).toContain("PHASE 2");
    expect(lastUserMessage.value).toContain("teleconsultation");
    expect(lastUserMessage.value).toContain("communication=15");
  });

  it("communicationWeight=0 sur anamnese_examen (invariant zéro-régression)", async () => {
    for (const file of FIXTURE_FILES) {
      const fx = await loadFixture(file);
      if (fx.expectedStationType !== "anamnese_examen") continue;
      expect(fx.expectedCommunicationWeight, `fixture ${file}`).toBe(0);
    }
  });
});

// Vérifications mathématiques indépendantes : on confirme que le
// expectedGlobalScore figé dans chaque fixture est cohérent avec la formule
// `Σ(score × poids_canonique) / Σ(poids_canonique > 0)` appliquée aux scores
// Sonnet et aux poids canoniques (Phase 2 table). Depuis le bug B hotfix,
// les poids dans mockedSonnet sont ignorés — la formule canonique est la
// seule source de vérité. Ce test protège contre un glissement silencieux
// entre les scores par axe et le globalScore gelé.
describe("J4 non-régression — cohérence arithmétique globalScore vs scores × poids canoniques", () => {
  for (const file of FIXTURE_FILES) {
    it(`${file} — expectedGlobalScore = Σ(score × poids_canonique) / Σ(poids>0)`, async () => {
      const fx = await loadFixture(file);
      const canonical = fx.expectedCanonicalWeights;
      const sections = fx.mockedSonnet.scores.sections;
      const weightedSum = sections.reduce((acc, s) => {
        const wPct = canonical[s.key] ?? 0;
        return acc + s.score * (wPct / 100);
      }, 0);
      const totalWeight = sections.reduce((acc, s) => {
        const wPct = canonical[s.key] ?? 0;
        return acc + (wPct > 0 ? wPct / 100 : 0);
      }, 0);
      const computed = totalWeight === 0 ? 0 : weightedSum / totalWeight;
      // Tolérance 1 point pour arrondi int (Math.round vs virgule flottante).
      expect(Math.abs(computed - fx.expectedGlobalScore), `fixture ${file}`).toBeLessThanOrEqual(1);
    });
  }
});
