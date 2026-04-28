// Phase 5 J2 — couverture du lexique médico-légal.
//
// Pour chaque entrée du lexique on couvre :
//   • un exemple positif (transcription qui DOIT matcher au moins
//     un pattern),
//   • un contre-exemple (transcription qui ne DOIT matcher AUCUN
//     pattern — protection contre les regex trop larges).
//
// Cette couverture évite les régressions silencieuses : si un futur
// commit assouplit une regex au point qu'elle matche un texte neutre,
// le contre-exemple casse le test immédiatement.

import { describe, expect, it } from "vitest";
import {
  countLexiconMatches,
  LEGAL_AXES,
  LEGAL_LEXICON,
  LEGAL_LEXICON_VERSION,
  listLegalLexiconKeys,
} from "../lib/legalLexicon";

describe("legalLexicon — invariants statiques", () => {
  it("expose une version sémantique", () => {
    expect(LEGAL_LEXICON_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("4 axes exactement (reconnaissance / verbalisation / décision / communication)", () => {
    expect([...LEGAL_AXES].sort()).toEqual([
      "communication",
      "decision",
      "reconnaissance",
      "verbalisation",
    ]);
  });

  it("chaque entrée a au moins 1 pattern", () => {
    for (const [key, entry] of Object.entries(LEGAL_LEXICON)) {
      expect(entry.patterns.length, `entrée vide : ${key}`).toBeGreaterThan(0);
    }
  });

  it("chaque entrée déclare un axis valide", () => {
    for (const [key, entry] of Object.entries(LEGAL_LEXICON)) {
      expect(LEGAL_AXES, `axe inconnu pour ${key}`).toContain(entry.axis);
    }
  });

  it("listLegalLexiconKeys retourne toutes les clés", () => {
    expect(listLegalLexiconKeys()).toEqual(Object.keys(LEGAL_LEXICON));
  });
});

// ─── Pour chaque entrée du lexique, un exemple + un contre-exemple ───
//
// Le format `[positif, négatif]`. On garde des phrases naturelles et
// courtes — pas des templates regex inversés. L'objectif est de tester
// LA SÉMANTIQUE du concept, pas un pattern particulier.

interface LexiconCase {
  key: string;
  positive: string;
  negative: string;
}

const CASES: LexiconCase[] = [
  // ─── AMBOSS-24 must_verbalize ───
  {
    key: "secret professionnel (art. 321 CP)",
    positive: "Je suis tenu au secret professionnel selon l'article 321 du Code pénal.",
    negative: "On a parlé de mon emploi du temps au cabinet hier soir.",
  },
  {
    key: "droit d'aviser vs devoir d'aviser",
    positive: "Il faut distinguer le droit d'aviser du devoir d'aviser dans votre situation.",
    negative: "Ce que je fais aujourd'hui, c'est juste vous écouter et noter vos symptômes.",
  },
  {
    key: "ressources LAVI / centres d'aide aux victimes",
    positive: "Je peux vous orienter vers la LAVI, l'aide aux victimes, qui propose un accompagnement gratuit.",
    negative: "On va commencer par une simple prise de tension, d'accord ?",
  },
  {
    key: "certificat médical descriptif à fin de preuve",
    positive: "Je peux établir un certificat médical descriptif des lésions, à fin de preuve si vous décidez de porter plainte.",
    negative: "Je vous prescris du paracétamol pour la douleur.",
  },
  {
    key: "respect de l'autonomie de la patiente",
    positive: "Je respecte votre autonomie, c'est votre choix et vous décidez.",
    negative: "Le ciel est gris ce matin, prenez un parapluie.",
  },
  {
    key: "confidentialité maintenue sauf danger imminent",
    positive: "La confidentialité est maintenue sauf en cas de danger imminent.",
    negative: "Je vais peser et mesurer votre tension artérielle.",
  },
  // ─── AMBOSS-24 must_avoid ───
  {
    key: "promettre confidentialité absolue sans nuance",
    positive: "Je vous promets une confidentialité absolue, rien ne sortira d'ici.",
    negative: "Tout ce que vous me dites est entendu avec respect.",
  },
  {
    key: "signaler à l'insu de la patiente sans danger imminent",
    positive: "Je vais signaler ce que vous me dites sans vous le dire.",
    negative: "Si je décide de signaler, je vous en informerai d'abord.",
  },
  {
    key: "minimiser les faits ou les ecchymoses",
    positive: "Vos bleus, c'est rien d'inquiétant, ça va passer.",
    negative: "Vos ecchymoses sont multiples et d'âges différents, c'est important.",
  },
  {
    key: "imposer le dépôt de plainte",
    positive: "Vous devez absolument porter plainte, c'est obligatoire.",
    negative: "Le dépôt de plainte reste votre choix, je suis là pour vous accompagner si vous le souhaitez.",
  },
  {
    key: "utiliser un terme banalisant (« dispute conjugale »)",
    positive: "Bon, c'est une simple dispute conjugale, ça arrive.",
    negative: "Je vois des ecchymoses qui me préoccupent, parlez-moi de ce qui s'est passé.",
  },

  // ─── USMLE-34 must_verbalize ───
  {
    key: "devoir d'aviser l'APEA (art. 364bis CP / art. 314c CC)",
    positive: "J'ai un devoir d'aviser l'APEA, c'est l'autorité de protection, art. 364bis CP.",
    negative: "Comment vont les enfants à l'école cette année ?",
  },
  {
    key: "enfants en danger priment sur secret professionnel",
    positive: "Les enfants en danger priment sur le secret professionnel, c'est l'intérêt de l'enfant.",
    negative: "Vos enfants sont rentrés à la maison après l'école.",
  },
  {
    key: "informer la patiente du signalement (transparence)",
    positive: "Je vais vous informer du signalement à l'APEA, par transparence.",
    negative: "Vous reprendrez rendez-vous dans deux semaines pour un contrôle.",
  },
  {
    key: "ressources LAVI / foyer d'accueil pour la patiente",
    positive: "Je peux vous orienter vers un foyer d'accueil pour femmes et la LAVI.",
    negative: "Je vous donne une ordonnance pour des vitamines.",
  },
  {
    key: "orientation pédiatrique pour évaluation des enfants",
    positive: "Je propose une consultation pédiatrique pour une évaluation des enfants.",
    negative: "Vos taux sanguins sont bons, on continue comme ça.",
  },
  {
    key: "non-jugement et soutien",
    positive: "Je ne vous juge pas, je suis là pour vous soutenir.",
    negative: "Bonjour, asseyez-vous, je vais prendre vos paramètres.",
  },
  // ─── USMLE-34 must_avoid ───
  {
    key: "promettre de ne rien signaler malgré les enfants",
    positive: "Je vous promets que je ne signalerai rien à personne.",
    negative: "Vu la situation des enfants, je vais devoir aviser l'APEA.",
  },
  {
    key: "signaler dans le dos de la patiente sans l'informer",
    positive: "Je vais signaler à votre insu, vous n'avez pas besoin de le savoir.",
    negative: "Avant tout signalement je vous expliquerai ce que je fais et pourquoi.",
  },
  {
    key: "blâmer la patiente pour l'inaction",
    positive: "Vous auriez dû le quitter avant, pourquoi êtes-vous restée ?",
    negative: "Ce n'est ni votre faute ni votre responsabilité, on va trouver des solutions ensemble.",
  },
  {
    key: "culpabiliser le retour au domicile",
    positive: "Si vous rentrez ce soir, c'est de votre faute pour les enfants.",
    negative: "Je comprends que rentrer est compliqué, on va voir ce qui est possible.",
  },
  {
    key: "imposer un dépôt de plainte immédiat",
    positive: "Vous devez immédiatement porter plainte, c'est obligatoire.",
    negative: "Si vous voulez en parler à la police, je peux vous y accompagner mais ce n'est pas obligatoire.",
  },

  // ─── RESCOS-72 must_verbalize ───
  {
    key: "refus motivé du certificat médical",
    positive: "Je ne peux pas vous délivrer ce certificat médical.",
    negative: "Vous avez bien dormi cette nuit ?",
  },
  {
    key: "cadre légal du faux dans les titres (CP-318)",
    positive: "Le faux dans les titres est puni par l'article 318 du Code pénal.",
    negative: "On va prendre votre tension artérielle maintenant.",
  },
  {
    key: "responsabilité disciplinaire FMH (CDM art. 34)",
    positive: "Le code de déontologie FMH (art. 34 CDM) m'interdit d'attester contraire à la vérité.",
    negative: "Le ciel est nuageux aujourd'hui.",
  },
  {
    key: "alternatives non frauduleuses (dialogue employeur, congés sans solde, médiation)",
    positive: "Vous pouvez demander des congés sans solde ou solliciter une médiation RH.",
    negative: "Reprenez du paracétamol si la douleur revient.",
  },
  {
    key: "validation empathique de la difficulté du patient",
    positive: "Je comprends, c'est vraiment une situation difficile pour vous.",
    negative: "Le pollen est élevé cette semaine.",
  },
  {
    key: "préservation de la relation thérapeutique malgré le refus",
    positive: "On peut continuer le suivi, n'hésitez pas à me revoir si quelque chose change.",
    negative: "Sortez d'ici immédiatement.",
  },
  // ─── RESCOS-72 must_avoid ───
  {
    key: "émettre le certificat « pour cette fois »",
    positive: "Bon, exceptionnellement, pour cette fois je vais vous le faire.",
    negative: "Je ne peux pas faire d'exception, le cadre est le même pour tous.",
  },
  {
    key: "refuser sans expliquer le cadre légal",
    positive: "Non, je refuse, c'est non.",
    negative: "Je refuse, et je vous explique pourquoi : l'article 318 CP punit le faux dans les titres.",
  },
  {
    key: "moraliser ou juger le patient",
    positive: "Ce que vous me demandez, c'est malhonnête.",
    negative: "Je vois que la situation est complexe, parlons des options possibles.",
  },
  {
    key: "menacer de signaler le patient à l'employeur",
    positive: "Je vais le dire à votre employeur si vous insistez.",
    negative: "Ce que vous me dites reste entre nous, et je n'en parle à personne d'extérieur.",
  },
  {
    key: "rompre la relation thérapeutique de manière abrupte",
    positive: "Cette consultation est terminée, ne revenez plus.",
    negative: "On peut continuer à se voir, je reste votre médecin.",
  },
];

describe("legalLexicon — exemples positifs et négatifs par entrée", () => {
  it.each(CASES)("« $key » → matche le positif", ({ key, positive }) => {
    const { matches, entry } = countLexiconMatches(key, positive);
    expect(entry, `entrée manquante pour ${key}`).toBeDefined();
    expect(matches, `aucun pattern matché pour ${key}: ${positive}`).toBeGreaterThanOrEqual(1);
  });

  it.each(CASES)("« $key » → ne matche PAS le négatif", ({ key, negative }) => {
    const { matches } = countLexiconMatches(key, negative);
    expect(matches, `faux positif sur ${key}: ${negative}`).toBe(0);
  });

  it("toutes les entrées du lexique sont couvertes par un cas de test", () => {
    const lexiconKeys = new Set(Object.keys(LEGAL_LEXICON));
    const caseKeys = new Set(CASES.map((c) => c.key));
    const missing: string[] = [];
    for (const k of lexiconKeys) if (!caseKeys.has(k)) missing.push(k);
    expect(missing, `entrée(s) sans test : ${missing.join(", ")}`).toEqual([]);
  });
});

describe("legalLexicon — alignement avec les fixtures pilotes", () => {
  // Tout `candidate_must_verbalize` / `candidate_must_avoid` des 3
  // pilotes Phase 5 J1 doit avoir une entrée dans le lexique. Garde-fou
  // contre les drifts silencieux entre fixtures et lexique.
  it("toute fixture pilote a une entrée lexique correspondante", async () => {
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const PATIENT_DIR = path.resolve(__dirname, "..", "data", "patient");
    const allItems: string[] = [];
    const files = ["Patient_AMBOSS_2.json", "Patient_USMLE_2.json", "Patient_RESCOS_4.json"];
    for (const f of files) {
      const raw = await fs.readFile(path.join(PATIENT_DIR, f), "utf-8");
      const parsed = JSON.parse(raw) as { stations: Array<Record<string, unknown>> };
      for (const station of parsed.stations) {
        const ctx = station.legalContext as
          | { candidate_must_verbalize?: string[]; candidate_must_avoid?: string[] }
          | undefined;
        if (!ctx) continue;
        if (ctx.candidate_must_verbalize) allItems.push(...ctx.candidate_must_verbalize);
        if (ctx.candidate_must_avoid) allItems.push(...ctx.candidate_must_avoid);
      }
    }
    const missing = allItems.filter((it) => !(it in LEGAL_LEXICON));
    expect(missing, `entrées non couvertes : ${missing.join(" | ")}`).toEqual([]);
  });

  it("la polarité antiPattern est cohérente avec must_verbalize vs must_avoid", async () => {
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const PATIENT_DIR = path.resolve(__dirname, "..", "data", "patient");
    const files = ["Patient_AMBOSS_2.json", "Patient_USMLE_2.json", "Patient_RESCOS_4.json"];
    const polarityErrors: string[] = [];
    for (const f of files) {
      const raw = await fs.readFile(path.join(PATIENT_DIR, f), "utf-8");
      const parsed = JSON.parse(raw) as { stations: Array<Record<string, unknown>> };
      for (const station of parsed.stations) {
        const ctx = station.legalContext as
          | { candidate_must_verbalize?: string[]; candidate_must_avoid?: string[] }
          | undefined;
        if (!ctx) continue;
        for (const it of ctx.candidate_must_verbalize ?? []) {
          if (LEGAL_LEXICON[it]?.antiPattern) {
            polarityErrors.push(`${it} → antiPattern=true mais classé must_verbalize`);
          }
        }
        for (const it of ctx.candidate_must_avoid ?? []) {
          if (LEGAL_LEXICON[it] && !LEGAL_LEXICON[it].antiPattern) {
            polarityErrors.push(`${it} → antiPattern=false mais classé must_avoid`);
          }
        }
      }
    }
    expect(polarityErrors).toEqual([]);
  });
});
