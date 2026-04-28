// Phase 5 J2 — tests unitaires de l'évaluateur médico-légal heuristique.
//
// Objectifs :
//   • 1 transcript "parfait" par pilote → score axe ≥ 80 % (les 3 catégories
//     : secret_pro_levee, signalement_maltraitance, certificat_complaisance).
//   • 1 transcript "partiel" → score 30–60 %.
//   • 1 transcript "vide" → score 0 (sauf axes sans must_verbalize : 100).
//   • 1 transcript anti-pattern → pénalité présente, item dans `avoided`.
//   • Tests d'erreurs : station inconnue, station sans legalContext.
//
// 100 % déterministe : zéro mock OpenAI, zéro mock Anthropic, juste
// initCatalog() pour charger les fixtures réelles.

import { beforeAll, describe, expect, it } from "vitest";
import { initCatalog } from "../services/stationsService";
import {
  evaluateLegal,
  LegalEvaluatorNoLegalContextError,
  LegalEvaluatorStationNotFoundError,
} from "../services/legalEvaluator";

beforeAll(async () => {
  await initCatalog();
});

// ─── Transcripts canoniques par pilote ───
//
// "parfait" couvre TOUS les items must_verbalize (avec ≥ 2 patterns
// matchés par item visé) et N'INCLUT PAS les anti-patterns must_avoid.
// "partiel" couvre la moitié environ. "vide" est neutre.

const TRANSCRIPTS = {
  // ─── AMBOSS-24 — secret_pro_levee, refer ───
  "AMBOSS-24": {
    perfect: `
      Bonjour Madame, je vois sur votre dossier des ecchymoses multiples d'âges différents.
      Je tiens à vous rappeler que je suis tenu au secret professionnel — c'est l'article 321
      du Code pénal qui régit ma confidentialité. Cette confidentialité est maintenue sauf en
      cas de danger imminent pour vous-même ou pour un tiers.
      Il faut bien distinguer le droit d'aviser du devoir d'aviser : aujourd'hui je suis dans
      le cadre du droit d'aviser, pas du devoir.
      Je peux établir un certificat médical descriptif des lésions, à fin de preuve, si vous
      souhaitez plus tard porter plainte. Je peux aussi vous orienter vers la LAVI, l'aide aux
      victimes, qui propose un accompagnement gratuit. Vous pouvez aussi vous rapprocher des
      centres d'aide aux victimes près de chez vous.
      Je respecte totalement votre autonomie ; c'est votre choix, et vous décidez du rythme.
    `,
    partial: `
      Je vois vos ecchymoses. Je suis tenu au secret professionnel, art. 321 CP.
      On peut parler de la LAVI si vous voulez, mais c'est votre choix.
    `,
    empty: `
      Bonjour. Asseyez-vous. Je vais prendre votre tension. Voilà, c'est noté.
    `,
    antiPattern: `
      Madame, je vous promets une confidentialité absolue, rien ne sortira d'ici.
      Vous devez absolument porter plainte, c'est obligatoire dans votre situation.
      Bon, c'est une simple dispute conjugale, ça arrive à tout le monde.
    `,
  },

  // ─── USMLE-34 — signalement_maltraitance, report ───
  "USMLE-34": {
    perfect: `
      Madame, je comprends que c'est très douloureux. Je ne vous juge pas, je suis là pour
      vous soutenir.
      Vu les enfants à la maison, en particulier votre fils giflé récemment, j'ai un devoir
      d'aviser l'APEA — c'est l'autorité de protection de l'enfant, art. 364bis CP et art.
      314c CC. Les enfants en danger priment sur le secret professionnel : c'est l'intérêt
      supérieur de l'enfant qui guide ma décision.
      Je vais vous informer du signalement à l'APEA, par transparence : vous avez le droit
      de savoir ce que je fais et pourquoi.
      Pour vous-même, je peux vous orienter vers un foyer d'accueil pour femmes et la LAVI.
      Pour les enfants, je propose une consultation pédiatrique pour une évaluation.
    `,
    partial: `
      Madame, je vais aviser l'APEA pour les enfants. Je ne vous juge pas.
    `,
    empty: `
      Bonjour, comment allez-vous aujourd'hui ? La météo est clémente.
    `,
    antiPattern: `
      Je vous promets que je ne signalerai rien à personne, restez tranquille.
      Vous auriez dû le quitter avant, pourquoi êtes-vous restée si longtemps ?
      Si vous rentrez ce soir, c'est de votre faute pour les enfants.
      Je vais signaler à votre insu, vous n'avez pas besoin de le savoir.
      Vous devez immédiatement porter plainte, c'est obligatoire.
    `,
  },

  // ─── RESCOS-72 — certificat_complaisance, decline_certificate ───
  "RESCOS-72": {
    perfect: `
      Marc, je comprends, c'est vraiment une situation difficile pour vous, je vois bien combien
      ça vous pèse.
      Mais je ne peux pas vous délivrer ce certificat médical, je refuse de signer ce certificat —
      ce serait un faux dans les titres, c'est puni par l'article 318 du Code pénal (CP-318).
      Le code de déontologie FMH (art. 34 CDM) m'interdit également d'attester contraire à la
      vérité — j'engagerais ma responsabilité disciplinaire devant la FMH.
      On peut chercher des alternatives non frauduleuses : un dialogue avec votre employeur,
      des congés sans solde, ou solliciter une médiation RH pour parler avec votre employeur
      autrement.
      On peut continuer le suivi ensemble, n'hésitez pas à me revoir si la situation change.
      Je reste votre médecin et je reste disponible.
    `,
    partial: `
      Marc, je ne peux pas vous délivrer ce certificat, c'est faux dans les titres CP-318.
      On peut continuer à se voir, je reste votre médecin.
    `,
    empty: `
      Bonjour Marc. Asseyez-vous. Comment ça va ?
    `,
    antiPattern: `
      Bon, exceptionnellement, pour cette fois je vais vous le faire.
      Mais je vais le dire à votre employeur si vous insistez.
      Vous mentez, ce que vous me demandez, c'est malhonnête.
      Cette consultation est terminée, ne revenez plus.
    `,
  },
};

const PILOTS = ["AMBOSS-24", "USMLE-34", "RESCOS-72"] as const;

describe("legalEvaluator — transcripts canoniques par pilote", () => {
  for (const stationId of PILOTS) {
    describe(stationId, () => {
      it("transcript « parfait » → ≥ 80 % par axe non-vide, missing/avoided vides", async () => {
        const result = await evaluateLegal({
          stationId,
          transcript: TRANSCRIPTS[stationId].perfect,
        });
        expect(result.unmapped).toEqual([]);
        expect(result.avoided).toEqual([]);
        expect(result.missing).toEqual([]);
        for (const axis of ["reconnaissance", "verbalisation", "decision", "communication"] as const) {
          const ax = result.axes[axis];
          // On asserte la borne haute uniquement sur les axes qui contiennent
          // au moins un must_verbalize (un axe sans item est neutre à 100).
          const hasPositiveItems = ax.items.some((i) => !i.isAntiPattern);
          if (hasPositiveItems) {
            expect(ax.score_pct, `${stationId}/${axis} score=${ax.score_pct}`).toBeGreaterThanOrEqual(80);
          } else {
            expect(ax.score_pct).toBe(100);
          }
        }
      });

      it("transcript « partiel » → score moyen entre 20 % et 70 % sur ≥ 1 axe", async () => {
        const result = await evaluateLegal({
          stationId,
          transcript: TRANSCRIPTS[stationId].partial,
        });
        // Au moins un axe (avec must_verbalize) doit être en zone partielle.
        const partialAxes = (
          ["reconnaissance", "verbalisation", "decision", "communication"] as const
        ).filter((axis) => {
          const ax = result.axes[axis];
          const hasPositive = ax.items.some((i) => !i.isAntiPattern);
          return hasPositive && ax.score_pct >= 20 && ax.score_pct <= 70;
        });
        expect(partialAxes.length, `aucun axe partiel pour ${stationId}`).toBeGreaterThan(0);
      });

      it("transcript « vide » → score 0 sur les axes avec must_verbalize, missing > 0", async () => {
        const result = await evaluateLegal({
          stationId,
          transcript: TRANSCRIPTS[stationId].empty,
        });
        expect(result.missing.length, `${stationId} missing devrait être non-vide`).toBeGreaterThan(0);
        expect(result.avoided).toEqual([]);
        for (const axis of ["reconnaissance", "verbalisation", "decision", "communication"] as const) {
          const ax = result.axes[axis];
          const hasPositive = ax.items.some((i) => !i.isAntiPattern);
          if (hasPositive) {
            expect(ax.score_pct, `${stationId}/${axis} doit être 0`).toBe(0);
          }
        }
      });

      it("transcript « anti-pattern » → ≥ 1 item dans avoided, pénalité visible", async () => {
        const result = await evaluateLegal({
          stationId,
          transcript: TRANSCRIPTS[stationId].antiPattern,
        });
        expect(result.avoided.length).toBeGreaterThan(0);
        // Au moins un axe a au moins un item avec grade < 0.
        const hasNegativeGrade = (
          ["reconnaissance", "verbalisation", "decision", "communication"] as const
        ).some((axis) =>
          result.axes[axis].items.some((i) => i.isAntiPattern && i.grade < 0),
        );
        expect(hasNegativeGrade).toBe(true);
      });
    });
  }
});

describe("legalEvaluator — erreurs", () => {
  it("station inconnue → LegalEvaluatorStationNotFoundError", async () => {
    await expect(
      evaluateLegal({ stationId: "DOES-NOT-EXIST", transcript: "" }),
    ).rejects.toBeInstanceOf(LegalEvaluatorStationNotFoundError);
  });

  it("station sans legalContext → LegalEvaluatorNoLegalContextError", async () => {
    // RESCOS-1 (adénopathie sus-claviculaire) n'a PAS de legalContext.
    await expect(
      evaluateLegal({ stationId: "RESCOS-1", transcript: "Bonjour" }),
    ).rejects.toBeInstanceOf(LegalEvaluatorNoLegalContextError);
  });
});

describe("legalEvaluator — invariants de structure", () => {
  it("réponse contient les 4 axes + lexiconVersion", async () => {
    const result = await evaluateLegal({
      stationId: "AMBOSS-24",
      transcript: TRANSCRIPTS["AMBOSS-24"].perfect,
    });
    expect(Object.keys(result.axes).sort()).toEqual([
      "communication",
      "decision",
      "reconnaissance",
      "verbalisation",
    ]);
    expect(result.lexiconVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("category, expected_decision, mandatory_reporting reflètent legalContext", async () => {
    const r1 = await evaluateLegal({ stationId: "AMBOSS-24", transcript: "" });
    expect(r1.category).toBe("secret_pro_levee");
    expect(r1.expected_decision).toBe("refer");
    expect(r1.mandatory_reporting).toBe(false);

    const r2 = await evaluateLegal({ stationId: "USMLE-34", transcript: "" });
    expect(r2.category).toBe("signalement_maltraitance");
    expect(r2.expected_decision).toBe("report");
    expect(r2.mandatory_reporting).toBe(true);

    const r3 = await evaluateLegal({ stationId: "RESCOS-72", transcript: "" });
    expect(r3.category).toBe("certificat_complaisance");
    expect(r3.expected_decision).toBe("decline_certificate");
    expect(r3.mandatory_reporting).toBe(false);
  });
});
