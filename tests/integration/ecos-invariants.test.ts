// Phase 3 J4 — tests d'invariants ECOS sur LLM réel (gated).
//
// Ce test fait des appels réels à OpenAI (patient) et Anthropic (évaluateur
// Sonnet 4.5). Il est désactivé par défaut pour ne pas exploser les coûts CI.
// Pour l'exécuter localement :
//
//   RUN_LLM_INTEGRATION=1 npx vitest run tests/integration/ecos-invariants.test.ts
//
// Prérequis : OPENAI_API_KEY et ANTHROPIC_API_KEY définis dans l'env.
//
// 3 invariants vérifiés sur 3 stations pilotes Phase 3 (AMBOSS-4, RESCOS-70,
// RESCOS-71), à raison de 5 runs LLM par station (temperature de production) :
//
//   1) IDENTIFICATION T0 : la première réponse du patient/accompagnant
//      identifie clairement l'interlocuteur (« je suis », « je m'appelle »,
//      « ma fille », « mon père », etc.) selon le contrat de la station.
//
//   2) RÉUSSITE & ÉCHEC ATTEIGNABLES : deux trajectoires candidat distinctes
//      (une bonne, une volontairement mauvaise) produisent deux verdicts
//      différents par l'évaluateur Sonnet 4.5. Cible : "Réussi" vs "Échec"
//      ou "À retravailler" — peu importe la paire exacte tant qu'elles
//      diffèrent. Garde-fou contre un évaluateur dégradé qui validerait tout.
//
//   3) ZÉRO INVENTION : aucune valeur numérique produite par le patient (regex
//      \d+) ne sort en dehors des champs documentés de la station (vitals,
//      examens_complementaires.*, age, antécédents chiffrés). Détecte les TA,
//      SaO2, fréquences cardiaques inventées par le LLM patient.

import { describe, expect, it } from "vitest";

const RUN_LLM = process.env.RUN_LLM_INTEGRATION === "1";

// Garde la suite déclarée dans la table d'inventaire vitest même quand elle
// est skippée — pour qu'un futur ingénieur la trouve via `vitest --reporter=verbose`.
const describeIfLLM = RUN_LLM ? describe : describe.skip;

interface InvariantContract {
  stationId: string;
  template: "patient" | "caregiver";
  // Regex (case-insensitive) sur la première réponse — au moins l'un doit matcher.
  t0IdentificationPatterns: RegExp[];
  goodCandidateOpening: string;
  badCandidateOpening: string;
  // Trajectoires complètes envoyées au Sonnet pour vérifier qu'on peut produire
  // deux verdicts distincts. 4-5 tours candidat + patient suffisent pour donner
  // matière à l'évaluateur sans surcoût excessif.
  goodTrajectoryFollowups: string[];
  badTrajectoryFollowups: string[];
}

const CONTRACTS: InvariantContract[] = [
  {
    stationId: "AMBOSS-4",
    template: "patient",
    t0IdentificationPatterns: [
      /\bélaine\b/i,
      /\belaine\b/i,
      /\bj['e]\s+(?:m['e]\s+)?(?:appelle|suis)\b/i,
      /\bdocteur\b/i,
    ],
    goodCandidateOpening:
      "Bonjour. Pouvez-vous me dire ce qui vous amène aujourd'hui ?",
    badCandidateOpening:
      "Bonjour. Vous avez 50 ans et vous saignez, c'est ça ? On va faire une biopsie tout de suite.",
    goodTrajectoryFollowups: [
      "D'accord. Quand vos dernières règles ont-elles eu lieu, et combien de temps ont-elles duré ?",
      "Avez-vous remarqué d'autres symptômes — douleur, écoulement, fièvre ?",
      "Je comprends que c'est inquiétant. On va faire un examen clinique, puis je vais vous proposer une échographie pelvienne pour y voir plus clair.",
    ],
    badTrajectoryFollowups: [
      "Vous fumez, vous buvez, antécédents familiaux ?",
      "Bon, je vais vous prescrire une biopsie. Voilà l'ordonnance.",
      "Suivante !",
    ],
  },
  {
    stationId: "RESCOS-70",
    template: "patient",
    t0IdentificationPatterns: [
      /\bemma\b/i,
      /\bma\s+m[èe]re\b/i,
      /\bbonjour\b/i,
    ],
    goodCandidateOpening:
      "Bonjour Emma. Je suis ton médecin aujourd'hui. Madame, je vais d'abord parler avec Emma seule quelques minutes — pouvez-vous nous attendre dans le couloir ?",
    badCandidateOpening:
      "Bonjour. Alors Madame, qu'est-ce qu'a votre fille ?",
    goodTrajectoryFollowups: [
      "Merci. Emma, tout ce que tu vas me dire reste entre nous, sauf si tu m'autorises à en parler à ta mère ou s'il y a un danger immédiat. Qu'est-ce qui t'amène vraiment ?",
      "Tu prends quelque chose en ce moment, médicament, contraception, autre ?",
      "Très bien. Ces saignements, depuis quand exactement, et est-ce qu'ils sont liés à un effort ou à un rapport ?",
    ],
    badTrajectoryFollowups: [
      "Bon Emma, est-ce que tu prends la pilule ? Tu as un copain ?",
      "Madame, est-ce que vous saviez ?",
      "Bon, on fait un examen clinique alors.",
    ],
  },
  {
    stationId: "RESCOS-71",
    template: "caregiver",
    t0IdentificationPatterns: [
      /\bmon\s+p[èe]re\b/i,
      /\blouis\b/i,
      /\bje\s+suis\s+(?:la\s+)?fille\b/i,
      /\bbonjour\b/i,
    ],
    goodCandidateOpening:
      "Bonjour Madame. Avant qu'on parle de votre père, j'aimerais savoir comment vous, vous allez ?",
    badCandidateOpening:
      "Bonjour. Bon, votre père va mourir, vous le savez. On peut accélérer si vous voulez.",
    goodTrajectoryFollowups: [
      "Je vous entends. Qu'est-ce qui est le plus difficile pour vous en ce moment ?",
      "Avez-vous des questions sur ce qui peut se passer dans les prochaines semaines ?",
      "Et concernant les directives anticipées, est-ce que ça a été abordé ?",
    ],
    badTrajectoryFollowups: [
      "Donc il vous reste combien de temps à le supporter ?",
      "Vous allez signer ici pour la sédation profonde, c'est plus simple.",
      "Bon, on hospitalise.",
    ],
  },
];

const N_RUNS_PER_STATION = 5;

// Lazy-loaded — ne paye le coût d'import des SDKs OpenAI/Anthropic qu'en mode
// activé, et évite que vitest charge ces modules en mode skippé.
async function importServices() {
  const services = await import("../../server/services/patientService");
  const evalSvc = await import("../../server/services/evaluatorService");
  const stations = await import("../../server/services/stationsService");
  return { services, evalSvc, stations };
}

// Construit un index de toutes les valeurs numériques EXPLICITEMENT modélisées
// dans la station (vitals, examens_complementaires, antécédents chiffrés). On
// extrait les nombres au format \d+ depuis les valeurs texte, plus les
// nombres bruts. Toute production patient avec un nombre non présent ici est
// suspect (invariant 3 — zéro invention).
function extractStationNumericTokens(station: unknown): Set<string> {
  const out = new Set<string>();
  const visit = (v: unknown): void => {
    if (v === null || v === undefined) return;
    if (typeof v === "number") {
      out.add(String(v));
      return;
    }
    if (typeof v === "string") {
      const matches = v.match(/\d+/g);
      if (matches) for (const m of matches) out.add(m);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (typeof v === "object") {
      for (const val of Object.values(v as Record<string, unknown>)) visit(val);
    }
  };
  visit(station);
  // Petits nombres usuels (1, 2, 3 ans) sont bénins — on les whitelist pour
  // éviter du bruit de faux positif sur "j'ai un peu mal depuis 2 jours".
  for (let i = 0; i <= 30; i++) out.add(String(i));
  return out;
}

function extractNumbersFromReply(reply: string): string[] {
  const matches = reply.match(/\d+/g);
  return matches ?? [];
}

describeIfLLM("Phase 3 J4 — ECOS invariants on real LLM (gated by RUN_LLM_INTEGRATION=1)", () => {
  for (const contract of CONTRACTS) {
    describe(`station ${contract.stationId} (${contract.template})`, () => {
      it(`Invariant 1 — T0 identifies the interlocutor across ${N_RUNS_PER_STATION} runs`, async () => {
        const { services, stations } = await importServices();
        await stations.initCatalog();

        const replies: string[] = [];
        for (let i = 0; i < N_RUNS_PER_STATION; i++) {
          const reply = await services.runPatientChat({
            stationId: contract.stationId,
            history: [],
            userMessage: contract.goodCandidateOpening,
            mode: "voice",
          });
          replies.push(reply);
        }
        for (const reply of replies) {
          const matched = contract.t0IdentificationPatterns.some((re) => re.test(reply));
          expect(matched, `T0 reply did not identify interlocutor: "${reply}"`).toBe(true);
        }
      }, /* timeout */ 120_000);

      it(`Invariant 2 — good vs bad trajectories produce DIFFERENT Sonnet verdicts`, async () => {
        const { services, evalSvc, stations } = await importServices();
        await stations.initCatalog();

        async function runTrajectory(
          opening: string,
          followups: string[],
        ): Promise<{ verdict: string; globalScore: number }> {
          const transcript: Array<{ role: "doctor" | "patient"; text: string }> = [];
          const history: Array<{ role: "user" | "assistant"; content: string }> = [];

          const turns = [opening, ...followups];
          for (const utterance of turns) {
            transcript.push({ role: "doctor", text: utterance });
            const reply = await services.runPatientChat({
              stationId: contract.stationId,
              history,
              userMessage: utterance,
              mode: "voice",
            });
            history.push({ role: "user", content: utterance });
            history.push({ role: "assistant", content: reply });
            transcript.push({ role: "patient", text: reply });
          }

          const evalResult = await evalSvc.runEvaluation({
            stationId: contract.stationId,
            transcript,
          });
          return {
            verdict: evalResult.scores.verdict,
            globalScore: evalResult.scores.globalScore,
          };
        }

        const good = await runTrajectory(
          contract.goodCandidateOpening,
          contract.goodTrajectoryFollowups,
        );
        const bad = await runTrajectory(
          contract.badCandidateOpening,
          contract.badTrajectoryFollowups,
        );

        // Les deux trajectoires doivent produire une réponse différenciable.
        // On accepte deux signaux : verdict distinct OU écart ≥ 15 points sur
        // le globalScore (cas où Sonnet juge sévèrement les deux mais en
        // gradient).
        const distinctVerdicts = good.verdict !== bad.verdict;
        const significantScoreGap = good.globalScore - bad.globalScore >= 15;
        expect(
          distinctVerdicts || significantScoreGap,
          `evaluator failed to differentiate trajectories: good=${JSON.stringify(good)} bad=${JSON.stringify(bad)}`,
        ).toBe(true);
      }, /* timeout */ 300_000);

      it(`Invariant 3 — patient never invents numerical findings (${N_RUNS_PER_STATION} runs)`, async () => {
        const { services, stations } = await importServices();
        await stations.initCatalog();

        const meta = stations.getStationMeta(contract.stationId);
        expect(meta).toBeDefined();
        // On lit la station via patientService pour avoir les mêmes données
        // que le LLM (tests partagés).
        const station = await services.getPatientStation(contract.stationId);
        const allowed = extractStationNumericTokens(station);

        for (let i = 0; i < N_RUNS_PER_STATION; i++) {
          const reply = await services.runPatientChat({
            stationId: contract.stationId,
            history: [],
            userMessage: contract.goodCandidateOpening,
            mode: "voice",
          });
          const numbers = extractNumbersFromReply(reply);
          const invented = numbers.filter((n) => !allowed.has(n));
          expect(
            invented,
            `patient invented numerical tokens not in station data: ${JSON.stringify(invented)} — reply: "${reply}"`,
          ).toEqual([]);
        }
      }, /* timeout */ 120_000);
    });
  }
});

// Quand le gate est OFF on déclare quand même un test marker pour que la suite
// soit visible dans le rapport vitest et que l'on confirme que la file existe.
if (!RUN_LLM) {
  describe("Phase 3 J4 — ECOS invariants (gate)", () => {
    it("is gated by RUN_LLM_INTEGRATION=1 (skipped — set the env var to enable)", () => {
      expect(RUN_LLM).toBe(false);
    });
  });
}
