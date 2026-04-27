// Phase 4 J3 — tests E2E LLM gated du cloisonnement knowledgeScope et
// du vocabulaire `lay`. Désactivés par défaut pour ne pas exploser les
// coûts CI ; activer avec :
//
//   RUN_LLM_INTEGRATION=1 npx vitest run tests/integration/phase4-j3-cloisonnement.test.ts
//
// Prérequis : OPENAI_API_KEY défini.
//
// Trois scénarios canoniques validés sur LLM réel :
//
//   1) RESCOS-70 — Trifecta Emma + Mère :
//      a) Emma révèle la pilule à voix nue quand le médecin tag « [À Emma] ».
//      b) La mère, interrogée explicitement (« [À Maman] savez-vous si Emma
//         prend une contraception ? »), NE révèle JAMAIS pilule/contraception
//         /Cerazette/désogestrel/spotting/copain — sur 5 essais.
//
//   2) RESCOS-71 — Vocabulaire lay strict (Martine 52 ans, accompagnante) :
//      Sur 5 essais répondant à « Quels sont les symptômes de votre père ? »,
//      la réponse ne contient AUCUN terme banni de LAY_CONSTRAINTS
//      (dyspnée, asthénie, cachexie, œdème, ictère, …).
//
//   3) RESCOS-9b — Parent répond, vocabulaire lay :
//      « Que s'est-il passé ? » sur 5 essais — aucun terme banni
//      (pas d'« antalgie de décharge » ni « boiterie d'esquive »).
//
// Le test assert au mot-pour-mot via la table LAY_CONSTRAINTS partagée
// avec l'unit test `vocabularyConstraints.test.ts` — pas de divergence
// silencieuse possible.

import { describe, expect, it } from "vitest";
import { runPatientChat } from "../../server/services/patientService";
import { initCatalog } from "../../server/services/stationsService";
import { detectLayLeaks } from "../../server/lib/vocabularyConstraints";

const RUN_LLM = process.env.RUN_LLM_INTEGRATION === "1";
const describeIfLLM = RUN_LLM ? describe : describe.skip;

// Termes-clés qui ne doivent jamais apparaître dans une réponse de la
// mère sur RESCOS-70 (informations cloisonnées par knowledgeScope).
const RESCOS_70_LEAK_PATTERNS: RegExp[] = [
  /\bpilule\b/i,
  /\bcerazette\b/i,
  /\bdésogestrel\b/i,
  /\bcontracept\w*/i,
  /\bspotting\b/i,
  /\bcopain\b/i,
];

const TRIALS = 5;

describeIfLLM("Phase 4 J3 — cloisonnement knowledgeScope sur LLM réel", () => {
  it(
    `RESCOS-70 — Mère ne révèle JAMAIS la pilule (${TRIALS} essais)`,
    async () => {
      await initCatalog();
      const offenders: Array<{ trial: number; reply: string; matched: string }> = [];
      for (let trial = 1; trial <= TRIALS; trial++) {
        const outcome = await runPatientChat({
          stationId: "RESCOS-70",
          history: [],
          userMessage:
            "[À Maman] Madame Delacroix, savez-vous si Emma prend une contraception ou si elle a un copain ?",
          mode: "text",
          currentSpeakerId: "emma",
        });
        if (outcome.type !== "reply") {
          throw new Error(`Tour ${trial} : outcome type=${outcome.type}, attendu 'reply'`);
        }
        for (const re of RESCOS_70_LEAK_PATTERNS) {
          const m = outcome.reply.match(re);
          if (m) {
            offenders.push({ trial, reply: outcome.reply, matched: m[0] });
            break;
          }
        }
      }
      if (offenders.length > 0) {
        // eslint-disable-next-line no-console
        console.error("[J3 cloisonnement] leaks mère RESCOS-70 :", offenders);
      }
      expect(offenders).toEqual([]);
    },
    180_000,
  );

  it(
    `RESCOS-71 — Martine en registre lay strict (${TRIALS} essais, 0 jargon)`,
    async () => {
      await initCatalog();
      const offenders: Array<{ trial: number; reply: string; leaks: string[] }> = [];
      for (let trial = 1; trial <= TRIALS; trial++) {
        const outcome = await runPatientChat({
          stationId: "RESCOS-71",
          history: [],
          userMessage: "Quels sont les symptômes de votre père en ce moment ?",
          mode: "text",
          currentSpeakerId: "martine",
        });
        if (outcome.type !== "reply") {
          throw new Error(`Tour ${trial} : outcome type=${outcome.type}`);
        }
        const leaks = detectLayLeaks(outcome.reply);
        if (leaks.length > 0) {
          offenders.push({
            trial,
            reply: outcome.reply,
            leaks: leaks.map((l) => `${l.forbidden} → ${l.matchedText}`),
          });
        }
      }
      if (offenders.length > 0) {
        // eslint-disable-next-line no-console
        console.error("[J3 vocab] leaks Martine RESCOS-71 :", offenders);
      }
      expect(offenders).toEqual([]);
    },
    180_000,
  );

  it(
    `RESCOS-9b — Parent en registre lay strict (${TRIALS} essais, 0 jargon)`,
    async () => {
      await initCatalog();
      const offenders: Array<{ trial: number; reply: string; leaks: string[] }> = [];
      for (let trial = 1; trial <= TRIALS; trial++) {
        const outcome = await runPatientChat({
          stationId: "RESCOS-9b",
          history: [],
          userMessage: "Que s'est-il passé ? Décrivez-moi ce que vous avez observé chez Charlotte.",
          mode: "text",
          currentSpeakerId: "parent",
        });
        if (outcome.type !== "reply") {
          throw new Error(`Tour ${trial} : outcome type=${outcome.type}`);
        }
        const leaks = detectLayLeaks(outcome.reply);
        if (leaks.length > 0) {
          offenders.push({
            trial,
            reply: outcome.reply,
            leaks: leaks.map((l) => `${l.forbidden} → ${l.matchedText}`),
          });
        }
      }
      if (offenders.length > 0) {
        // eslint-disable-next-line no-console
        console.error("[J3 vocab] leaks Parent RESCOS-9b :", offenders);
      }
      expect(offenders).toEqual([]);
    },
    180_000,
  );
});
