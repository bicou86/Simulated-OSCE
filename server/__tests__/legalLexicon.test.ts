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
  buildLegalLeakDirective,
  countLexiconMatches,
  findUnmappedLawCodes,
  LEGAL_AXES,
  LEGAL_BLACKLIST_TERMS,
  LEGAL_LAW_CODE_PATTERNS,
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

  // ─── Phase 7 J1 — violence_sexuelle_adulte must_verbalize ───
  {
    key: "reconnaissance du contexte d'agression sexuelle",
    positive: "Vous me décrivez ce qui ressemble à une agression sexuelle.",
    negative: "Vous avez fait du sport hier, je vois sur votre dossier.",
  },
  {
    key: "absence de consentement / contrainte",
    positive: "Vous parlez d'actes sexuels sans votre consentement, sous contrainte sexuelle.",
    negative: "Vous avez signé le formulaire d'admission tout à l'heure.",
  },
  {
    key: "orientation centre LAVI / aide aux victimes (adulte)",
    positive: "Je peux vous orienter vers un centre LAVI pour un accompagnement gratuit.",
    negative: "Je vous prescris du paracétamol pour la fièvre.",
  },
  {
    key: "kit médico-légal sous 72h / examen médico-légal",
    positive: "Nous pouvons proposer un kit médico-légal sous 72h pour le recueil de preuves.",
    negative: "Je vais ausculter vos poumons, respirez profondément.",
  },
  {
    key: "écoute sans jugement et validation du récit de la victime",
    positive: "Je vous écoute sans jugement, je vous crois, vous êtes ici en sécurité.",
    negative: "Asseyez-vous, je vais préparer le brassard de tension.",
  },
  {
    key: "soutien psychologique et orientation spécialisée",
    positive: "Je vous propose un soutien psychologique avec un psychologue formé.",
    negative: "Voici une ordonnance pour vos vitamines D.",
  },
  {
    key: "respect du rythme de la victime",
    positive: "On avance à votre rythme, à votre demande, sans vous brusquer.",
    negative: "Je vais vous prescrire un examen sanguin de routine.",
  },
  {
    key: "confidentialité et autonomie de la décision de plainte",
    positive: "La confidentialité est garantie sauf à votre demande, et la plainte reste votre choix.",
    negative: "Le résultat de votre prise de sang sera disponible demain.",
  },
  // violence_sexuelle_adulte must_avoid
  {
    key: "victim-blaming / questions inversant la culpabilité",
    positive: "Pourquoi étiez-vous habillée comme ça à cette heure ?",
    negative: "Prenez le temps qu'il vous faut, je suis là pour vous écouter.",
  },
  {
    key: "imposer la plainte à la victime adulte capable",
    positive: "Vous devez absolument porter plainte, c'est le seul moyen.",
    negative: "Porter plainte reste votre décision, je vous accompagnerai si vous le souhaitez.",
  },
  {
    key: "signalement automatique police sans accord (adulte capable)",
    positive: "Je dois obligatoirement informer la police, c'est automatique.",
    negative: "Si vous le souhaitez, je peux vous accompagner pour une déclaration à la police.",
  },

  // ─── Phase 7 J1 — capacite_discernement must_verbalize ───
  {
    key: "définition tripartite de la capacité de discernement (CC-16)",
    positive: "Pour évaluer la capacité de discernement (CC-16), il faut comprendre, apprécier, décider.",
    negative: "Vous m'avez dit que vous habitez à Lausanne avec votre fils.",
  },
  {
    key: "consentement éclairé (CDM art. 3)",
    positive: "Cela suppose un consentement éclairé selon CDM art. 3.",
    negative: "Vous avez bien dormi cette nuit ?",
  },
  {
    key: "évaluation psychiatrique spécialisée",
    positive: "Je propose une évaluation par un psychiatre spécialisé.",
    negative: "Je vais vous prescrire un test sanguin de glycémie.",
  },
  {
    key: "documenter l'évaluation tripartite",
    positive: "Je vais documenter l'évaluation et tracer dans le dossier.",
    negative: "Je vais nettoyer votre plaie avant de la suturer.",
  },
  {
    key: "saisine APEA / curatelle de représentation (CC-443a / CC-394)",
    positive: "On peut envisager une saisine APEA pour une curatelle de représentation (CC-443a).",
    negative: "Buvez bien d'eau pendant la journée pour éviter la déshydratation.",
  },
  {
    key: "test de compréhension active (reformulation par le patient)",
    positive: "Qu'avez-vous compris de ce que je vous ai dit ? Expliquez-moi avec vos mots.",
    negative: "Pouvez-vous me donner votre numéro de carte d'assurance ?",
  },
  {
    key: "respect de l'autonomie résiduelle",
    positive: "Je respecte votre autonomie résiduelle et vos volontés exprimées.",
    negative: "Le scanner est prévu pour demain matin à 8 heures.",
  },
  {
    key: "association de la famille avec accord du patient",
    positive: "Avec votre accord, je vais associer la famille à la discussion.",
    negative: "Tournez la tête vers la gauche, s'il vous plaît.",
  },
  // capacite_discernement must_avoid
  {
    key: "question fermée « vous comprenez ? » (ne teste pas la compréhension)",
    positive: "Voilà, vous comprenez ?",
    negative: "Pouvez-vous me dire ce que vous avez retenu de notre échange ?",
  },
  {
    key: "négation de l'autonomie résiduelle (famille décide à la place)",
    positive: "Maintenant votre famille décide pour vous, ce n'est plus à vous de décider.",
    negative: "Vous restez décisionnaire, et nous associerons votre famille avec votre accord.",
  },

  // ─── Phase 7 J1 — directives_anticipees must_verbalize ───
  {
    key: "recherche de directives anticipées existantes (CC-370)",
    positive: "Avez-vous rédigé des directives anticipées ? CC-370 prévoit ce dispositif.",
    negative: "Avez-vous mangé avant de venir ce matin ?",
  },
  {
    key: "mandat pour cause d'inaptitude (CC-360)",
    positive: "Avez-vous établi un mandat pour cause d'inaptitude (CC-360) ?",
    negative: "Vous avez signé le formulaire de consentement opératoire.",
  },
  {
    key: "représentation thérapeutique (CC-377 / CC-378)",
    positive: "Qui souhaitez-vous comme représentant thérapeutique selon CC-378 ?",
    negative: "Vos résultats de bilan rénal sont normaux.",
  },
  {
    key: "ouverture du dialogue sur les volontés futures",
    positive: "Souhaitez-vous discuter de vos volontés futures et de qui vous voulez comme représentant ?",
    negative: "Vous êtes à jour de vos vaccins, c'est très bien.",
  },
  {
    key: "respect des volontés exprimées dans les directives",
    positive: "Nous allons respecter vos volontés exprimées dans vos directives.",
    negative: "Le rendez-vous de contrôle est dans trois mois.",
  },
  {
    key: "ordre légal de représentation à défaut de directives (CC-378)",
    positive: "À défaut de directives, l'ordre légal de représentation CC-378 s'applique.",
    negative: "Buvez votre tisane chaude avant de dormir.",
  },
  {
    key: "orientation conseil juridique pour rédaction",
    positive: "Pour la rédaction, je vous recommande un conseil juridique ou un notaire.",
    negative: "Le résultat du test de grossesse est négatif.",
  },
  {
    key: "communication respectueuse sur les volontés évolutives",
    positive: "Vos directives peuvent évoluer ; vous pouvez les modifier à tout moment, vos volontés sont prioritaires.",
    negative: "Vous reverrez l'orthopédiste dans deux semaines.",
  },
  // directives_anticipees must_avoid
  {
    key: "éviter le sujet des directives par gêne",
    positive: "Ce n'est pas le moment d'en parler, passons à autre chose.",
    negative: "C'est un sujet important, prenons le temps d'en parler ensemble.",
  },
  {
    key: "projeter ses propres valeurs sur les volontés du patient",
    positive: "À votre place je choisirais ce traitement, moi je ferais comme ça.",
    negative: "Quelles sont vos valeurs et préférences face à ce choix ?",
  },

  // ─── Phase 7 J1 — responsabilite_teleconsult must_verbalize ───
  {
    key: "limites de l'examen téléphonique reconnues",
    positive: "Je reconnais les limites de l'examen à distance, je ne peux pas vous examiner physiquement.",
    negative: "Votre tension est à 120 sur 80, tout va bien.",
  },
  {
    key: "vérification d'identité du patient à distance",
    positive: "Je vais d'abord faire une vérification d'identité : votre nom complet et date de naissance, s'il vous plaît.",
    negative: "Vos résultats sont arrivés ce matin par courriel.",
  },
  {
    key: "consentement à la téléconsultation",
    positive: "Êtes-vous d'accord pour cette téléconsultation à distance aujourd'hui ?",
    negative: "Asseyez-vous, je vais ausculter votre cœur.",
  },
  {
    key: "consigne de surveillance écrite et red flags",
    positive: "Voici la consigne de surveillance : si les symptômes s'aggravent, considérez ces red flags.",
    negative: "On reprendra rendez-vous l'année prochaine pour le suivi annuel.",
  },
  {
    key: "orientation urgences ou consultation physique en cas de doute",
    positive: "En cas de doute, je vous propose de vous rendre aux urgences pour une consultation physique.",
    negative: "Mangez équilibré et faites un peu d'exercice.",
  },
  {
    key: "documentation horodatée du contact",
    positive: "Je vais tracer la téléconsultation dans le dossier avec date et heure.",
    negative: "Souriez pour la photo de la carte d'identité.",
  },
  {
    key: "explicitation des limites de la téléconsultation au patient",
    positive: "Je ne peux pas vous voir aujourd'hui, et je vous propose une consultation physique si possible.",
    negative: "Je vais palper votre abdomen, dites-moi si ça vous gêne.",
  },
  {
    key: "transparence sur le caractère partiel de l'évaluation",
    positive: "Mon évaluation reste partielle, je ne peux pas tout conclure à distance.",
    negative: "L'examen clinique est complet et rassurant.",
  },
  // responsabilite_teleconsult must_avoid
  {
    key: "prescription à distance sans documentation rigoureuse",
    positive: "Je vous prescris à distance sans vous voir, c'est plus rapide.",
    negative: "Avant toute prescription, je préfère un examen physique en consultation.",
  },
  {
    key: "rappel ultérieur insuffisant face à un red flag",
    positive: "Je vous rappelle dans une semaine, voilà.",
    negative: "Si quelque chose change avant 24 heures, contactez les urgences sans attendre.",
  },
  {
    key: "rassurance creuse sans examen",
    positive: "Tout va bien, ne vous inquiétez pas, à distance je peux vous affirmer que ce n'est rien.",
    negative: "Je préfère vous voir en personne avant de me prononcer.",
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

describe("legalLexicon — codes de loi (Phase 5 J3)", () => {
  it("LEGAL_LAW_CODE_PATTERNS couvre les codes utilisés par les 3 pilotes", async () => {
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const PATIENT_DIR = path.resolve(__dirname, "..", "data", "patient");
    const allCodes = new Set<string>();
    const files = ["Patient_AMBOSS_2.json", "Patient_USMLE_2.json", "Patient_RESCOS_4.json"];
    for (const f of files) {
      const raw = await fs.readFile(path.join(PATIENT_DIR, f), "utf-8");
      const parsed = JSON.parse(raw) as { stations: Array<Record<string, unknown>> };
      for (const station of parsed.stations) {
        const ctx = station.legalContext as { applicable_law?: string[] } | undefined;
        if (!ctx?.applicable_law) continue;
        for (const c of ctx.applicable_law) allCodes.add(c);
      }
    }
    const unmapped = findUnmappedLawCodes([...allCodes]);
    expect(unmapped, `codes non mappés : ${unmapped.join(", ")}`).toEqual([]);
  });

  it("findUnmappedLawCodes : retourne [] pour les codes mappés", () => {
    expect(findUnmappedLawCodes(["CP-321", "CP-318", "LAVI-art-1"])).toEqual([]);
  });

  it("findUnmappedLawCodes : retourne le sous-ensemble non mappé", () => {
    expect(findUnmappedLawCodes(["CP-321", "CP-999", "INCONNU-42"])).toEqual([
      "CP-999",
      "INCONNU-42",
    ]);
  });

  it("chaque entrée de LEGAL_LAW_CODE_PATTERNS a humanLabel + ≥ 1 detectPattern", () => {
    for (const [code, spec] of Object.entries(LEGAL_LAW_CODE_PATTERNS)) {
      expect(spec.humanLabel.length, `humanLabel vide : ${code}`).toBeGreaterThan(0);
      expect(spec.detectPatterns.length, `detectPatterns vide : ${code}`).toBeGreaterThan(0);
    }
  });

  it("LEGAL_BLACKLIST_TERMS : chaque entrée a term + ≥ 1 pattern", () => {
    for (const t of LEGAL_BLACKLIST_TERMS) {
      expect(t.term.length).toBeGreaterThan(0);
      expect(t.detectPatterns.length).toBeGreaterThan(0);
    }
  });

  it("buildLegalLeakDirective : contient le marker + le garde-fou + les codes humainLabel", () => {
    const dir = buildLegalLeakDirective(["CP-321", "CP-318"]);
    expect(dir).toContain("## CADRE JURIDIQUE — INTERDICTIONS STRICTES");
    expect(dir).toMatch(/r[ée]agir\s+[ée]motionnellement/i);
    expect(dir).toContain("art. 321 CP (secret professionnel)");
    expect(dir).toContain("art. 318 CP (faux dans les titres)");
  });

  it("buildLegalLeakDirective : applicable_law vide → directive avec mention « aucun code spécifique »", () => {
    const dir = buildLegalLeakDirective([]);
    expect(dir).toContain("aucun code spécifique");
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
