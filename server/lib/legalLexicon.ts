// Phase 5 J2 — lexique fermé pour l'évaluation médico-légale déterministe.
//
// CONTRAT
//   Pour chaque item textuel listé dans `candidate_must_verbalize` ou
//   `candidate_must_avoid` d'une station portant un `legalContext`, ce
//   lexique fournit :
//     • l'axe d'évaluation (reconnaissance / verbalisation / décision /
//       communication) sur lequel l'item compte,
//     • la liste de regex défensives qui détectent l'item dans une
//       transcription candidate,
//     • un drapeau `antiPattern: true` si l'item provient de la liste
//       des choses à ÉVITER (pénalité quand détecté).
//
// INVARIANTS (Phase 5 J2)
//   • ZÉRO appel LLM. Tout est table statique + RegExp.
//   • Clés = TEXTE LITTÉRAL des items dans le JSON station. Si une
//     fixture renomme un item, le lexique doit être mis à jour
//     explicitement — la divergence se voit immédiatement (l'item
//     remonte dans `missing` côté évaluateur).
//   • Les regex sont défensives : variantes orthographiques (avec/sans
//     accent), apostrophes courbes vs droites, abréviations courantes
//     (« CP 321 », « art. 321 », « article 321 »), pluriels.
//   • Lexique versionné via `LEGAL_LEXICON_VERSION` pour que les
//     consommateurs (UI score, audits, A/B tests) puissent tracer les
//     évolutions futures.
//
// HEURISTIQUE DE SCORE (consommée par legalEvaluator.ts)
//   • must_verbalize : 0 pattern matché → grade 0 ; 1 → grade 1 ;
//     ≥ 2 patterns DISTINCTS matchés → grade 2 (concept clairement
//     invoqué, pas une simple co-occurrence).
//   • must_avoid    : symétrique, mais pénalisant : 0 → 0 ; 1 → -1 ;
//     ≥ 2 → -2.

export const LEGAL_LEXICON_VERSION = "1.0.0";

export type LegalAxis =
  | "reconnaissance" // identifier le cadre légal applicable
  | "verbalisation"  // expliquer/annoncer ce cadre AU patient
  | "decision"       // poser la bonne action (signaler / refuser / orienter…)
  | "communication"; // tenue relationnelle (empathie, transparence, non-jugement)

export const LEGAL_AXES: readonly LegalAxis[] = [
  "reconnaissance",
  "verbalisation",
  "decision",
  "communication",
] as const;

export interface LegalLexiconEntry {
  axis: LegalAxis;
  patterns: RegExp[];
  antiPattern: boolean;
}

// Helper interne : autorise apostrophes droites ET courbes (« d'aviser »
// vs « d’aviser »), espaces multiples, lettres accentuées en bordure.
// Les patterns gardent une intention « concept invoqué », pas une
// recherche stricte de la formulation canonique.
const APOS = "['’ʼ]";

export const LEGAL_LEXICON: Record<string, LegalLexiconEntry> = {
  // ─────────────────────────────────────────────────────────────────
  // AMBOSS-24 — secret_pro_levee, refer
  // ─────────────────────────────────────────────────────────────────

  // must_verbalize
  "secret professionnel (art. 321 CP)": {
    axis: "reconnaissance",
    patterns: [
      /\bsecret\s+(?:professionnel|m[ée]dical|pro)\b/i,
      /\b(?:art(?:icle)?\.?\s*)?321\b/i,
      /\bCP[\s\-]?321\b/i,
    ],
    antiPattern: false,
  },
  "droit d'aviser vs devoir d'aviser": {
    axis: "reconnaissance",
    patterns: [
      new RegExp(`\\bdroit\\s+d${APOS}aviser\\b`, "i"),
      new RegExp(`\\bdevoir\\s+d${APOS}aviser\\b`, "i"),
      /\b364\b/, // CP-364 (droit) — souvent cité avec « droit d'aviser »
    ],
    antiPattern: false,
  },
  "ressources LAVI / centres d'aide aux victimes": {
    axis: "decision",
    patterns: [
      /\bLAVI\b/,
      /\baide\s+aux\s+victimes?\b/i,
      new RegExp(`\\bcentres?\\s+d${APOS}aide\\s+aux\\s+victimes?\\b`, "i"),
    ],
    antiPattern: false,
  },
  "certificat médical descriptif à fin de preuve": {
    axis: "decision",
    patterns: [
      /\bcertificat\s+m[ée]dical\b/i,
      /\bdescriptif\b/i,
      /\b(?:fin|titre|but)\s+de\s+preuve\b/i,
      /\bconstat\s+(?:de\s+)?l[ée]sions?\b/i,
    ],
    antiPattern: false,
  },
  "respect de l'autonomie de la patiente": {
    axis: "communication",
    patterns: [
      /\bautonomie\b/i,
      new RegExp(`\\brespect\\s+(?:de\\s+(?:la\\s+)?)?(?:son\\s+|sa\\s+|votre\\s+|l${APOS})?(?:choix|d[ée]cision|volont[ée])\\b`, "i"),
      /\bvotre\s+choix\b/i,
      /\bvous\s+d[ée]cidez\b/i,
    ],
    antiPattern: false,
  },
  "confidentialité maintenue sauf danger imminent": {
    axis: "verbalisation",
    patterns: [
      /\bconfidentialit[ée]\b/i,
      /\bdanger\s+(?:imminent|grave|s[ée]rieux)\b/i,
      /\bsauf\s+(?:si|en\s+cas\s+de)\b/i,
    ],
    antiPattern: false,
  },

  // must_avoid
  "promettre confidentialité absolue sans nuance": {
    axis: "verbalisation",
    patterns: [
      /\b(?:je\s+vous\s+)?promets?\b.{0,40}\b(?:rien\s+ne\s+sortira|confidentialit[ée]\s+absolue|tout\s+(?:reste|restera))\b/i,
      /\bconfidentialit[ée]\s+absolue\b/i,
      /\b(?:rien|aucune\s+info)\s+ne\s+sortira\b/i,
    ],
    antiPattern: true,
  },
  "signaler à l'insu de la patiente sans danger imminent": {
    axis: "decision",
    patterns: [
      // `\b` ne joue pas avec « à » (caractère hors \w en JS), on borne
      // donc avec un lookbehind permissif (début de chaîne ou non-lettre).
      new RegExp(`(?<=^|[^\\p{L}])à\\s+(?:l${APOS}insu|son\\s+insu|votre\\s+insu)\\b`, "iu"),
      /\b(?:je\s+vais\s+)?signaler\b.{0,40}\b(?:sans\s+(?:vous\s+le\s+)?dire|sans\s+vous\s+(?:en\s+)?(?:avertir|informer))\b/i,
      /\bsans\s+(?:vous|la)\s+pr[ée]venir\b/i,
    ],
    antiPattern: true,
  },
  "minimiser les faits ou les ecchymoses": {
    axis: "communication",
    patterns: [
      /\b(?:c'?est|ce\s+n'?est)\s+pas\s+(?:si\s+)?grave\b/i,
      new RegExp(`\\b(?:rien|peu)\\s+d${APOS}inqui[ée]tant\\b`, "i"),
      /\b(?:juste|simple)\s+(?:bleus?|ecchymoses?|h[ée]matomes?)\b/i,
      /\b[çc]a\s+va\s+passer\b/i,
    ],
    antiPattern: true,
  },
  "imposer le dépôt de plainte": {
    axis: "decision",
    patterns: [
      /\b(?:vous\s+)?devez\s+(?:absolument\s+)?(?:porter\s+plainte|d[ée]poser\s+(?:une\s+)?plainte)\b/i,
      /\bil\s+faut\s+(?:absolument\s+)?(?:porter\s+plainte|d[ée]poser\s+(?:une\s+)?plainte)\b/i,
      /\bobligatoirement?\b.{0,30}\bplainte\b/i,
    ],
    antiPattern: true,
  },
  "utiliser un terme banalisant (« dispute conjugale »)": {
    axis: "communication",
    patterns: [
      /\bdispute\s+(?:conjugale|de\s+couple|de\s+m[ée]nage)\b/i,
      /\b(?:petite\s+)?engueulade\b/i,
      new RegExp(`\\b(?:un\\s+)?coup\\s+de\\s+col[èe]re\\b`, "i"),
    ],
    antiPattern: true,
  },

  // ─────────────────────────────────────────────────────────────────
  // USMLE-34 — signalement_maltraitance, report
  // ─────────────────────────────────────────────────────────────────

  // must_verbalize
  "devoir d'aviser l'APEA (art. 364bis CP / art. 314c CC)": {
    axis: "reconnaissance",
    patterns: [
      /\bAPEA\b/,
      /\b364\s*bis\b/i,
      /\b314\s*c\b/i,
      new RegExp(`\\bdevoir\\s+d${APOS}aviser\\b`, "i"),
      /\bautorit[ée]\s+de\s+protection\b/i,
    ],
    antiPattern: false,
  },
  "enfants en danger priment sur secret professionnel": {
    axis: "reconnaissance",
    patterns: [
      /\benfants?\s+en\s+danger\b/i,
      /\b(?:priment?|pr[ée]vaut|l['’]emporte)\s+sur\b/i,
      /\bprotection\s+de\s+l['’]enfant\b/i,
      /\bint[ée]r[êe]t\s+(?:sup[ée]rieur\s+)?de\s+l['’]enfant\b/i,
    ],
    antiPattern: false,
  },
  "informer la patiente du signalement (transparence)": {
    axis: "verbalisation",
    patterns: [
      /\bje\s+(?:vais|dois)\s+(?:vous\s+)?(?:informer|dire|annoncer)\b.{0,40}\b(?:signalement|signaler|APEA)\b/i,
      /\btransparence\b/i,
      /\b(?:vous|je)\s+(?:le|en|la)?\s*pr[ée]viens?\b/i,
      /\bje\s+vous\s+annonce\b/i,
    ],
    antiPattern: false,
  },
  "ressources LAVI / foyer d'accueil pour la patiente": {
    axis: "decision",
    patterns: [
      /\bLAVI\b/,
      new RegExp(`\\bfoyer\\s+(?:d${APOS}accueil|pour\\s+femmes?)\\b`, "i"),
      new RegExp(`\\bmaison\\s+d${APOS}accueil\\b`, "i"),
      new RegExp(`\\baide\\s+aux\\s+victimes?\\b`, "i"),
    ],
    antiPattern: false,
  },
  "orientation pédiatrique pour évaluation des enfants": {
    axis: "decision",
    patterns: [
      /\bp[ée]diatre\b/i,
      /\bp[ée]diatrique\b/i,
      /\b[ée]valuation\s+(?:des\s+)?enfants?\b/i,
      /\bconsultation\s+(?:p[ée]diatrique|sp[ée]cialis[ée]e)\b/i,
    ],
    antiPattern: false,
  },
  "non-jugement et soutien": {
    axis: "communication",
    patterns: [
      /\bsans\s+(?:vous\s+)?juger\b/i,
      /\bje\s+ne\s+(?:vous\s+)?juge\s+pas\b/i,
      /\b(?:je\s+suis\s+)?l[àa]\s+pour\s+vous\s+(?:aider|soutenir|accompagner)\b/i,
      /\bsoutien\b/i,
    ],
    antiPattern: false,
  },

  // must_avoid
  "promettre de ne rien signaler malgré les enfants": {
    axis: "verbalisation",
    patterns: [
      /\b(?:je\s+(?:vous\s+)?)?promets?\b.{0,40}\b(?:rien\s+(?:dire|signaler)|ne\s+rien\s+(?:dire|signaler))\b/i,
      /\bje\s+ne\s+(?:dirai|signalerai)\s+rien\b/i,
      /\b(?:rien|aucun\s+signalement)\s+ne\s+sortira\b/i,
    ],
    antiPattern: true,
  },
  "signaler dans le dos de la patiente sans l'informer": {
    axis: "verbalisation",
    patterns: [
      /\bdans\s+(?:le|votre|son)\s+dos\b/i,
      // `\b` ne joue pas avec « à » (caractère hors \w en JS).
      new RegExp(`(?<=^|[^\\p{L}])à\\s+(?:l${APOS}insu|son\\s+insu|votre\\s+insu)\\b`, "iu"),
      /\bsans\s+(?:vous|la)\s+(?:le\s+)?dire\b/i,
    ],
    antiPattern: true,
  },
  "blâmer la patiente pour l'inaction": {
    axis: "communication",
    patterns: [
      new RegExp(`\\b(?:vous\\s+)?(?:devriez|auriez\\s+d[ûu])\\s+(?:partir|le\\s+quitter|agir)\\s+(?:plus\\s+t[ôo]t|avant)\\b`, "i"),
      /\bpourquoi\s+vous\s+(?:n['’]?avez\s+rien\s+fait|[êe]tes\s+rest[ée]e)\b/i,
      new RegExp(`\\bc${APOS}est\\s+(?:un\\s+peu\\s+)?(?:de\\s+)?votre\\s+faute\\b`, "i"),
    ],
    antiPattern: true,
  },
  "culpabiliser le retour au domicile": {
    axis: "communication",
    patterns: [
      new RegExp(`\\bsi\\s+vous\\s+rentrez\\b.{0,30}\\b(?:c${APOS}est|ce\\s+sera)\\s+(?:de\\s+)?votre\\s+(?:faute|responsabilit[ée])\\b`, "i"),
      /\bvous\s+ne\s+devez\s+(?:absolument\s+)?pas\s+rentrer\b/i,
      /\bvous\s+(?:mettez|exposez)\s+vos\s+enfants\s+en\s+danger\b/i,
    ],
    antiPattern: true,
  },
  "imposer un dépôt de plainte immédiat": {
    axis: "decision",
    patterns: [
      // Adverbe optionnel entre « devez » et « porter/déposer plainte »
      // — couvre « absolument », « immédiatement », « tout de suite ».
      /\b(?:vous\s+)?devez\s+(?:[a-zà-ÿ]+ment\s+)?(?:porter\s+plainte|d[ée]poser\s+(?:une\s+)?plainte)\b/iu,
      /\bil\s+faut\s+(?:[a-zà-ÿ]+ment\s+)?(?:porter\s+plainte|d[ée]poser\s+(?:une\s+)?plainte)\b/iu,
      /\bobligatoirement?\b.{0,30}\bplainte\b/i,
    ],
    antiPattern: true,
  },

  // ─────────────────────────────────────────────────────────────────
  // RESCOS-72 — certificat_complaisance, decline_certificate
  // ─────────────────────────────────────────────────────────────────

  // must_verbalize
  "refus motivé du certificat médical": {
    axis: "decision",
    patterns: [
      /\bje\s+ne\s+(?:peux|peux\s+pas|vais\s+pas)\b.{0,40}\b(?:[ée]tablir|d[ée]livrer|faire|r[ée]diger|signer)\b.{0,40}\bcertificat\b/i,
      /\brefuser?\s+(?:de\s+)?(?:vous\s+)?(?:[ée]tablir|d[ée]livrer|faire|r[ée]diger|signer)\b.{0,40}\bcertificat\b/i,
      /\bje\s+(?:ne\s+)?peux\s+pas\s+vous\s+(?:le\s+)?faire\b/i,
    ],
    antiPattern: false,
  },
  "cadre légal du faux dans les titres (CP-318)": {
    axis: "reconnaissance",
    patterns: [
      /\b(?:art(?:icle)?\.?\s*)?318\b/,
      /\bCP[\s\-]?318\b/,
      /\bfaux\s+dans\s+les?\s+titres?\b/i,
    ],
    antiPattern: false,
  },
  "responsabilité disciplinaire FMH (CDM art. 34)": {
    axis: "reconnaissance",
    patterns: [
      /\bFMH\b/,
      /\bCDM\b/,
      /\b(?:art(?:icle)?\.?\s*)?34\b.*\bCDM\b/i,
      /\bcode\s+de\s+d[ée]ontologie\b/i,
      /\b(?:responsabilit[ée]\s+)?disciplinaire\b/i,
    ],
    antiPattern: false,
  },
  "alternatives non frauduleuses (dialogue employeur, congés sans solde, médiation)": {
    axis: "decision",
    patterns: [
      /\bcong[ée]s?\s+sans\s+solde\b/i,
      /\bm[ée]diation\b/i,
      /\bdialogue\s+(?:avec\s+)?(?:l['’]?)?employeur\b/i,
      /\bRH\b/,
      /\b(?:parler|discuter)\s+(?:avec\s+)?(?:votre\s+)?employeur\b/i,
    ],
    antiPattern: false,
  },
  "validation empathique de la difficulté du patient": {
    axis: "communication",
    patterns: [
      /\bje\s+(?:comprends|entends)\b/i,
      /\b(?:c['’]est|ce\s+doit\s+[êe]tre)\s+(?:vraiment\s+)?(?:difficile|compliqu[ée]|p[ée]nible)\b/i,
      /\bsituation\s+(?:difficile|compliqu[ée]|d[ée]licate)\b/i,
      /\bje\s+vois\s+(?:bien\s+)?(?:que|combien)\b/i,
    ],
    antiPattern: false,
  },
  "préservation de la relation thérapeutique malgré le refus": {
    axis: "communication",
    patterns: [
      /\b(?:on|nous)\s+(?:pouvons|peut)\s+(?:continuer|garder|conserver|maintenir)\b.{0,40}\b(?:suivi|consult|relation)\b/i,
      /\b(?:revenir|me\s+revoir)\b.{0,40}\b(?:si|quand|d[èe]s\s+que)\b/i,
      /\bje\s+reste\s+(?:votre\s+m[ée]decin|disponible|l[àa])\b/i,
    ],
    antiPattern: false,
  },

  // must_avoid
  "émettre le certificat « pour cette fois »": {
    axis: "decision",
    patterns: [
      /\bpour\s+cette\s+fois\b/i,
      /\b(?:exceptionnellement|une\s+fois\s+n['’]est\s+pas\s+coutume)\b/i,
      /\b(?:d['’]?accord|ok)\s*,?\s+je\s+(?:vous\s+le\s+)?fais\b/i,
      /\bje\s+(?:vais|peux)\s+vous\s+(?:le\s+)?(?:faire|signer|d[ée]livrer)\b/i,
    ],
    antiPattern: true,
  },
  "refuser sans expliquer le cadre légal": {
    // Détection inverse : refus prononcé MAIS aucune mention de CP-318/FMH/légal
    // dans les ~200 caractères qui suivent (≈ un paragraphe). On veut détecter
    // le « non sec » non motivé, pas un refus motivé qui développe son cadre.
    // Heuristique simple ; l'axe `verbalisation` agrège la pénalité.
    axis: "verbalisation",
    patterns: [
      /\bje\s+(?:refuse|ne\s+(?:peux\s+pas|vais\s+pas))\b(?![\s\S]{0,200}\b(?:loi|l[ée]gal|318|CP|FMH|CDM|d[ée]ontologie|faux\s+dans)\b)/i,
      /\bnon[\s,.]+(?:c['’]est|cela)\s+(?:non|impossible)\b(?![\s\S]{0,200}\b(?:loi|l[ée]gal|318|CP|FMH|CDM|d[ée]ontologie|faux\s+dans)\b)/i,
    ],
    antiPattern: true,
  },
  "moraliser ou juger le patient": {
    axis: "communication",
    patterns: [
      /\b(?:c['’]est|ce\s+n['’]est)\s+pas\s+(?:bien|honn[êe]te|s[ée]rieux)\b/i,
      /\bvous\s+(?:devriez\s+)?avoir\s+honte\b/i,
      // Tolère ponctuation entre « demandez » et « c'est » (virgule, point).
      /\bce\s+que\s+vous\s+(?:faites|me\s+demandez)[\s,.;:]+(?:est|c['’]est)\s+(?:malhonn[êe]te|inacceptable)\b/i,
      /\bvous\s+mentez\b/i,
    ],
    antiPattern: true,
  },
  "menacer de signaler le patient à l'employeur": {
    axis: "communication",
    patterns: [
      /\b(?:je\s+vais|je\s+pourrais)\s+(?:le\s+)?dire\s+[àa]\s+(?:votre\s+)?(?:employeur|patron|chef|RH)\b/i,
      /\bsignaler\s+[àa]\s+(?:votre\s+)?(?:employeur|patron|chef|RH)\b/i,
      /\bpr[ée]venir\s+(?:votre\s+)?(?:employeur|patron|chef|RH)\b/i,
    ],
    antiPattern: true,
  },
  "rompre la relation thérapeutique de manière abrupte": {
    axis: "communication",
    patterns: [
      /\b(?:cette\s+)?consultation\s+(?:est\s+)?termin[ée]e\b/i,
      /\bne\s+revenez\s+plus\b/i,
      /\bje\s+ne\s+(?:suis|serai)\s+plus\s+votre\s+m[ée]decin\b/i,
      /\bsortez\b/i,
    ],
    antiPattern: true,
  },
};

// Helper d'audit : retourne l'ensemble des items couverts par le lexique.
// Utilisé par les tests pour vérifier que toute fixture pilote reste
// alignée (assertion : tous les `candidate_must_verbalize` /
// `candidate_must_avoid` des stations à legalContext doivent avoir une
// entrée dans LEGAL_LEXICON).
export function listLegalLexiconKeys(): string[] {
  return Object.keys(LEGAL_LEXICON);
}

// Helper de matching : compte le nombre de patterns DISTINCTS de l'entrée
// `entryKey` qui matchent dans `transcript`. Un pattern compte au plus une
// fois (pas de boost de score par occurrences répétées du même pattern).
export function countLexiconMatches(
  entryKey: string,
  transcript: string,
): { matches: number; entry: LegalLexiconEntry | undefined } {
  const entry = LEGAL_LEXICON[entryKey];
  if (!entry) return { matches: 0, entry: undefined };
  let matches = 0;
  for (const re of entry.patterns) {
    if (re.test(transcript)) matches += 1;
  }
  return { matches, entry };
}
