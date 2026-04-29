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

// Phase 7 J1 — bump v1.0.0 → v1.1.0 : ajout de 4 nouvelles catégories
// (violence_sexuelle_adulte, capacite_discernement, directives_anticipees,
// responsabilite_teleconsult). Les 3 catégories Phase 5 (secret_pro_levee,
// signalement_maltraitance, certificat_complaisance) sont conservées
// inchangées byte-à-byte (non-régression v1.0.0 stricte — cf. test
// `legalLexicon.v1.1.0.test.ts`).
export const LEGAL_LEXICON_VERSION = "1.1.0";

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

// Phase 7 J1 — étiquette de catégorie portée par chaque entrée du lexique.
// Permet d'énumérer la couverture (`listLegalLexiconCategories`) et de
// vérifier qu'aucune entrée n'a fui sa catégorie (audit mutex). Additif
// strict côté consommateur : `legalEvaluator` n'utilise pas ce champ pour
// scorer (les scores ne sont fonction que de `axis`/`patterns`/
// `antiPattern`), donc la non-régression v1.0.0 est garantie.
export type LegalLexiconCategory =
  // v1.0.0 (Phase 5)
  | "secret_pro_levee"
  | "signalement_maltraitance"
  | "certificat_complaisance"
  // v1.1.0 (Phase 7 J1) — extension pédagogique
  | "violence_sexuelle_adulte"
  | "capacite_discernement"
  | "directives_anticipees"
  | "responsabilite_teleconsult";

export const LEGAL_LEXICON_CATEGORIES: readonly LegalLexiconCategory[] = [
  "secret_pro_levee",
  "signalement_maltraitance",
  "certificat_complaisance",
  "violence_sexuelle_adulte",
  "capacite_discernement",
  "directives_anticipees",
  "responsabilite_teleconsult",
] as const;

export interface LegalLexiconEntry {
  axis: LegalAxis;
  category: LegalLexiconCategory;
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
    category: "secret_pro_levee",
    patterns: [
      /\bsecret\s+(?:professionnel|m[ée]dical|pro)\b/i,
      /\b(?:art(?:icle)?\.?\s*)?321\b/i,
      /\bCP[\s\-]?321\b/i,
    ],
    antiPattern: false,
  },
  "droit d'aviser vs devoir d'aviser": {
    axis: "reconnaissance",
    category: "secret_pro_levee",
    patterns: [
      new RegExp(`\\bdroit\\s+d${APOS}aviser\\b`, "i"),
      new RegExp(`\\bdevoir\\s+d${APOS}aviser\\b`, "i"),
      /\b364\b/, // CP-364 (droit) — souvent cité avec « droit d'aviser »
    ],
    antiPattern: false,
  },
  "ressources LAVI / centres d'aide aux victimes": {
    axis: "decision",
    category: "secret_pro_levee",
    patterns: [
      /\bLAVI\b/,
      /\baide\s+aux\s+victimes?\b/i,
      new RegExp(`\\bcentres?\\s+d${APOS}aide\\s+aux\\s+victimes?\\b`, "i"),
    ],
    antiPattern: false,
  },
  "certificat médical descriptif à fin de preuve": {
    axis: "decision",
    category: "secret_pro_levee",
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
    category: "secret_pro_levee",
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
    category: "secret_pro_levee",
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
    category: "secret_pro_levee",
    patterns: [
      /\b(?:je\s+vous\s+)?promets?\b.{0,40}\b(?:rien\s+ne\s+sortira|confidentialit[ée]\s+absolue|tout\s+(?:reste|restera))\b/i,
      /\bconfidentialit[ée]\s+absolue\b/i,
      /\b(?:rien|aucune\s+info)\s+ne\s+sortira\b/i,
    ],
    antiPattern: true,
  },
  "signaler à l'insu de la patiente sans danger imminent": {
    axis: "decision",
    category: "secret_pro_levee",
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
    category: "secret_pro_levee",
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
    category: "secret_pro_levee",
    patterns: [
      /\b(?:vous\s+)?devez\s+(?:absolument\s+)?(?:porter\s+plainte|d[ée]poser\s+(?:une\s+)?plainte)\b/i,
      /\bil\s+faut\s+(?:absolument\s+)?(?:porter\s+plainte|d[ée]poser\s+(?:une\s+)?plainte)\b/i,
      /\bobligatoirement?\b.{0,30}\bplainte\b/i,
    ],
    antiPattern: true,
  },
  "utiliser un terme banalisant (« dispute conjugale »)": {
    axis: "communication",
    category: "secret_pro_levee",
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
    category: "signalement_maltraitance",
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
    category: "signalement_maltraitance",
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
    category: "signalement_maltraitance",
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
    category: "signalement_maltraitance",
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
    category: "signalement_maltraitance",
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
    category: "signalement_maltraitance",
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
    category: "signalement_maltraitance",
    patterns: [
      /\b(?:je\s+(?:vous\s+)?)?promets?\b.{0,40}\b(?:rien\s+(?:dire|signaler)|ne\s+rien\s+(?:dire|signaler))\b/i,
      /\bje\s+ne\s+(?:dirai|signalerai)\s+rien\b/i,
      /\b(?:rien|aucun\s+signalement)\s+ne\s+sortira\b/i,
    ],
    antiPattern: true,
  },
  "signaler dans le dos de la patiente sans l'informer": {
    axis: "verbalisation",
    category: "signalement_maltraitance",
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
    category: "signalement_maltraitance",
    patterns: [
      new RegExp(`\\b(?:vous\\s+)?(?:devriez|auriez\\s+d[ûu])\\s+(?:partir|le\\s+quitter|agir)\\s+(?:plus\\s+t[ôo]t|avant)\\b`, "i"),
      /\bpourquoi\s+vous\s+(?:n['’]?avez\s+rien\s+fait|[êe]tes\s+rest[ée]e)\b/i,
      new RegExp(`\\bc${APOS}est\\s+(?:un\\s+peu\\s+)?(?:de\\s+)?votre\\s+faute\\b`, "i"),
    ],
    antiPattern: true,
  },
  "culpabiliser le retour au domicile": {
    axis: "communication",
    category: "signalement_maltraitance",
    patterns: [
      new RegExp(`\\bsi\\s+vous\\s+rentrez\\b.{0,30}\\b(?:c${APOS}est|ce\\s+sera)\\s+(?:de\\s+)?votre\\s+(?:faute|responsabilit[ée])\\b`, "i"),
      /\bvous\s+ne\s+devez\s+(?:absolument\s+)?pas\s+rentrer\b/i,
      /\bvous\s+(?:mettez|exposez)\s+vos\s+enfants\s+en\s+danger\b/i,
    ],
    antiPattern: true,
  },
  "imposer un dépôt de plainte immédiat": {
    axis: "decision",
    category: "signalement_maltraitance",
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
    category: "certificat_complaisance",
    patterns: [
      /\bje\s+ne\s+(?:peux|peux\s+pas|vais\s+pas)\b.{0,40}\b(?:[ée]tablir|d[ée]livrer|faire|r[ée]diger|signer)\b.{0,40}\bcertificat\b/i,
      /\brefuser?\s+(?:de\s+)?(?:vous\s+)?(?:[ée]tablir|d[ée]livrer|faire|r[ée]diger|signer)\b.{0,40}\bcertificat\b/i,
      /\bje\s+(?:ne\s+)?peux\s+pas\s+vous\s+(?:le\s+)?faire\b/i,
    ],
    antiPattern: false,
  },
  "cadre légal du faux dans les titres (CP-318)": {
    axis: "reconnaissance",
    category: "certificat_complaisance",
    patterns: [
      /\b(?:art(?:icle)?\.?\s*)?318\b/,
      /\bCP[\s\-]?318\b/,
      /\bfaux\s+dans\s+les?\s+titres?\b/i,
    ],
    antiPattern: false,
  },
  "responsabilité disciplinaire FMH (CDM art. 34)": {
    axis: "reconnaissance",
    category: "certificat_complaisance",
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
    category: "certificat_complaisance",
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
    category: "certificat_complaisance",
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
    category: "certificat_complaisance",
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
    category: "certificat_complaisance",
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
    category: "certificat_complaisance",
    patterns: [
      /\bje\s+(?:refuse|ne\s+(?:peux\s+pas|vais\s+pas))\b(?![\s\S]{0,200}\b(?:loi|l[ée]gal|318|CP|FMH|CDM|d[ée]ontologie|faux\s+dans)\b)/i,
      /\bnon[\s,.]+(?:c['’]est|cela)\s+(?:non|impossible)\b(?![\s\S]{0,200}\b(?:loi|l[ée]gal|318|CP|FMH|CDM|d[ée]ontologie|faux\s+dans)\b)/i,
    ],
    antiPattern: true,
  },
  "moraliser ou juger le patient": {
    axis: "communication",
    category: "certificat_complaisance",
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
    category: "certificat_complaisance",
    patterns: [
      /\b(?:je\s+vais|je\s+pourrais)\s+(?:le\s+)?dire\s+[àa]\s+(?:votre\s+)?(?:employeur|patron|chef|RH)\b/i,
      /\bsignaler\s+[àa]\s+(?:votre\s+)?(?:employeur|patron|chef|RH)\b/i,
      /\bpr[ée]venir\s+(?:votre\s+)?(?:employeur|patron|chef|RH)\b/i,
    ],
    antiPattern: true,
  },
  "rompre la relation thérapeutique de manière abrupte": {
    axis: "communication",
    category: "certificat_complaisance",
    patterns: [
      /\b(?:cette\s+)?consultation\s+(?:est\s+)?termin[ée]e\b/i,
      /\bne\s+revenez\s+plus\b/i,
      /\bje\s+ne\s+(?:suis|serai)\s+plus\s+votre\s+m[ée]decin\b/i,
      /\bsortez\b/i,
    ],
    antiPattern: true,
  },

  // ─────────────────────────────────────────────────────────────────
  // Phase 7 J1 — Catégorie A : violence_sexuelle_adulte
  //   Cadre CH : LAVI (loi sur l'aide aux victimes), CP-189 (contrainte
  //   sexuelle), CP-190 (viol), CP-191 (actes sexuels sur incapable),
  //   CDM-art-25 ; kit médico-légal cantonal sous 72h ; centre LAVI.
  //   Décision attendue : refer (orientation LAVI + médico-légal +
  //   plainte si la victime y consent — autonomie de la victime adulte
  //   capable de discernement). mandatory_reporting = false.
  // ─────────────────────────────────────────────────────────────────

  // must_verbalize
  "reconnaissance du contexte d'agression sexuelle": {
    axis: "reconnaissance",
    category: "violence_sexuelle_adulte",
    patterns: [
      /\bagression\s+sexuelle\b/i,
      /\bviol\b/i,
      /\bviolences?\s+sexuelles?\b/i,
      /\babus\s+sexuels?\b/i,
      /\bactes?\s+sexuels?\s+(?:non\s+consentis?|forc[ée]s?)\b/i,
    ],
    antiPattern: false,
  },
  "absence de consentement / contrainte": {
    axis: "reconnaissance",
    category: "violence_sexuelle_adulte",
    patterns: [
      /\babsence\s+de\s+consentement\b/i,
      /\bsans\s+(?:votre|son)\s+consentement\b/i,
      /\bcontrainte\s+(?:sexuelle|physique|morale|psychique)\b/i,
      /\bnon\s+consenti[se]?\b/i,
    ],
    antiPattern: false,
  },
  "orientation centre LAVI / aide aux victimes (adulte)": {
    axis: "decision",
    category: "violence_sexuelle_adulte",
    patterns: [
      /\bcentres?\s+LAVI\b/i,
      /\bLAVI\b/,
      new RegExp(`\\bloi\\s+(?:sur\\s+)?(?:l${APOS})?aide\\s+aux\\s+victimes?\\b`, "i"),
      /\bconsultation\s+sp[ée]cialis[ée]e\b/i,
    ],
    antiPattern: false,
  },
  "kit médico-légal sous 72h / examen médico-légal": {
    axis: "decision",
    category: "violence_sexuelle_adulte",
    patterns: [
      /\bkit\s+m[ée]dico[\s\-]l[ée]gal\b/i,
      /\bexamen\s+m[ée]dico[\s\-]l[ée]gal\b/i,
      /\b72\s*h(?:eures)?\b/i,
      /\brecueil\s+de\s+preuves?\b/i,
    ],
    antiPattern: false,
  },
  "écoute sans jugement et validation du récit de la victime": {
    axis: "verbalisation",
    category: "violence_sexuelle_adulte",
    patterns: [
      new RegExp(`\\b(?:je\\s+vous\\s+)?[ée]coute\\s+(?:votre\\s+)?r[ée]cit\\b`, "i"),
      /\bsans\s+jugement\b/i,
      /\bje\s+vous\s+crois\b/i,
      new RegExp(`\\bvous\\s+[êe]tes\\s+(?:ici\\s+)?en\\s+s[ée]curit[ée]\\b`, "i"),
      /\bpersonne\s+ne\s+vous\s+force\s+(?:[àa]\s+)?parler\b/i,
    ],
    antiPattern: false,
  },
  "soutien psychologique et orientation spécialisée": {
    axis: "decision",
    category: "violence_sexuelle_adulte",
    patterns: [
      /\bsoutien\s+psychologique\b/i,
      /\bpsychologue\b/i,
      /\bpsychiatre\b/i,
      /\bressources?\s+sp[ée]cialis[ée]es?\b/i,
    ],
    antiPattern: false,
  },
  "respect du rythme de la victime": {
    axis: "communication",
    category: "violence_sexuelle_adulte",
    patterns: [
      /\b(?:[àa]\s+)?votre\s+rythme\b/i,
      new RegExp(`\\b[àa]\\s+votre\\s+demande\\b`, "i"),
      new RegExp(`\\brespect\\s+(?:de\\s+)?(?:votre\\s+)?(?:rythme|temps|silence)\\b`, "i"),
    ],
    antiPattern: false,
  },
  "confidentialité et autonomie de la décision de plainte": {
    axis: "communication",
    category: "violence_sexuelle_adulte",
    patterns: [
      /\bconfidentialit[ée]\b.{0,40}\bsauf\s+(?:[àa]\s+)?votre\s+demande\b/i,
      new RegExp(`\\bplainte\\s+(?:reste\\s+)?votre\\s+(?:choix|d[ée]cision|droit)\\b`, "i"),
      /\bvous\s+d[ée]cidez\s+(?:de\s+)?(?:la\s+)?plainte\b/i,
    ],
    antiPattern: false,
  },

  // must_avoid
  "victim-blaming / questions inversant la culpabilité": {
    axis: "communication",
    category: "violence_sexuelle_adulte",
    patterns: [
      // « pourquoi étiez-vous habillée… » — autorise espace, tiret, ou
      // les deux entre les mots (« étiez-vous », « étiez vous »).
      new RegExp(`\\bpourquoi\\s+(?:[ée]tiez|[ée]tais)[\\s\\-]+vous\\s+habill[ée]e?\\b`, "i"),
      new RegExp(`\\b[êe]tes[\\s\\-]+vous\\s+s[ûu]re?\\b.{0,30}\\b(?:sans\\s+consentement|c${APOS}[ée]tait\\s+(?:vraiment|bien))\\b`, "i"),
      /\bavez[\s\-]+vous\s+(?:vraiment\s+)?dit\s+non\b/i,
      new RegExp(`\\bpourquoi\\s+ne\\s+pas\\s+(?:[êe]tre\\s+)?part[ie]e?\\s+(?:plus\\s+t[ôo]t)?\\b`, "i"),
    ],
    antiPattern: true,
  },
  "imposer la plainte à la victime adulte capable": {
    axis: "decision",
    category: "violence_sexuelle_adulte",
    patterns: [
      /\bvous\s+devez\s+(?:absolument\s+)?porter\s+plainte\b/i,
      /\bvous\s+devriez\s+porter\s+plainte\b/i,
      /\bil\s+faut\s+(?:absolument\s+)?porter\s+plainte\b/i,
    ],
    antiPattern: true,
  },
  "signalement automatique police sans accord (adulte capable)": {
    axis: "communication",
    category: "violence_sexuelle_adulte",
    patterns: [
      /\bje\s+(?:dois|vais)\s+(?:obligatoirement\s+)?(?:informer|appeler|pr[ée]venir)\s+la\s+police\b/i,
      new RegExp(`\\bje\\s+(?:dois|vais)\\s+(?:obligatoirement\\s+)?signaler\\s+[àa]\\s+la\\s+police\\b`, "i"),
      /\bla\s+police\s+(?:doit|sera)\s+(?:automatiquement\s+)?(?:inform[ée]e|pr[ée]venue)\b/i,
    ],
    antiPattern: true,
  },

  // ─────────────────────────────────────────────────────────────────
  // Phase 7 J1 — Catégorie B : capacite_discernement
  //   Cadre CH : CC-16 (capacité de discernement, définition tripartite),
  //   CC-443a (signalement APEA adulte vulnérable), CC-394 (curatelle de
  //   représentation), CDM-art-3 al-2 (consentement éclairé), directives
  //   ASSM. Décision attendue : refer (évaluation tripartite documentée +
  //   psychiatre + APEA si nécessaire). mandatory_reporting = false par
  //   défaut (sauf danger imminent → bascule PLAFA, hors scope J1).
  // ─────────────────────────────────────────────────────────────────

  // must_verbalize
  "définition tripartite de la capacité de discernement (CC-16)": {
    axis: "reconnaissance",
    category: "capacite_discernement",
    patterns: [
      /\bcapacit[ée]\s+de\s+discernement\b/i,
      /\b(?:art(?:icle)?\.?\s*)?16\b\s*CC\b/i,
      /\bCC[\s\-]?16\b/i,
      // Triade : 2 verbes parmi { comprendre, apprécier, décider } à
      // proximité (≤ 80 caractères) — typique de la définition académique.
      /\bcomprendre\b[\s\S]{0,80}\b(?:appr[ée]cier|d[ée]cider)\b/i,
      /\bappr[ée]cier\b[\s\S]{0,80}\bd[ée]cider\b/i,
    ],
    antiPattern: false,
  },
  "consentement éclairé (CDM art. 3)": {
    axis: "reconnaissance",
    category: "capacite_discernement",
    patterns: [
      /\bconsentement\s+[ée]clair[ée]\b/i,
      /\bconsentement\s+libre(?:\s+et\s+[ée]clair[ée])?\b/i,
      /\bCDM\s+art\.?\s*3\b/i,
    ],
    antiPattern: false,
  },
  "évaluation psychiatrique spécialisée": {
    axis: "decision",
    category: "capacite_discernement",
    patterns: [
      // `\b[ée]valuation` ne fonctionne pas en JS regex sans /u (les
      // lettres accentuées ne sont pas \w). On borne par lookbehind
      // permissif (début de chaîne ou caractère non-lettre) et on
      // capture tolérant (« par un psychiatre », « par psychiatre »,
      // « psychiatre » direct).
      new RegExp(`(?<=^|[^\\p{L}])[ée]valuation\\s+(?:par\\s+(?:un\\s+)?)?psychiatre\\b`, "iu"),
      new RegExp(`(?<=^|[^\\p{L}])[ée]valuation\\s+psychiatrique\\b`, "iu"),
      /\bavis\s+psychiatrique\b/i,
      /\bconsultation\s+psychiatrique\b/i,
    ],
    antiPattern: false,
  },
  "documenter l'évaluation tripartite": {
    axis: "decision",
    category: "capacite_discernement",
    patterns: [
      /\bdocumenter\s+(?:l['’]\s*)?[ée]valuation\b/i,
      /\btracer\s+(?:dans\s+(?:le\s+)?dossier|au\s+dossier)\b/i,
      /\bmotiver\s+(?:par\s+)?[ée]crit\b/i,
      /\bnoter\s+(?:dans\s+(?:le\s+)?dossier|au\s+dossier)\b/i,
    ],
    antiPattern: false,
  },
  "saisine APEA / curatelle de représentation (CC-443a / CC-394)": {
    axis: "decision",
    category: "capacite_discernement",
    patterns: [
      /\bAPEA\b/,
      /\bcuratelle\s+(?:de\s+)?repr[ée]sentation\b/i,
      /\bCC[\s\-]?443\s*a\b/i,
      /\bCC[\s\-]?394\b/i,
      new RegExp(`\\bautorit[ée]\\s+de\\s+protection\\s+(?:de\\s+l${APOS}adulte)?\\b`, "i"),
    ],
    antiPattern: false,
  },
  "test de compréhension active (reformulation par le patient)": {
    axis: "verbalisation",
    category: "capacite_discernement",
    patterns: [
      new RegExp(`\\bqu${APOS}avez[\\s\\-]vous\\s+compris\\b`, "i"),
      new RegExp(`\\bexpliquez[\\s\\-]moi\\s+(?:avec|dans)\\s+vos\\s+(?:propres\\s+)?mots\\b`, "i"),
      /\breformuler?\s+(?:ce\s+que\s+)?(?:je\s+vous\s+ai\s+dit|vous\s+avez\s+compris)\b/i,
      /\bquelles\s+(?:sont\s+)?(?:selon\s+vous\s+)?les\s+cons[ée]quences\b/i,
    ],
    antiPattern: false,
  },
  "respect de l'autonomie résiduelle": {
    axis: "communication",
    category: "capacite_discernement",
    patterns: [
      /\bautonomie\s+r[ée]siduelle\b/i,
      /\bvolont[ée]s?\s+(?:exprim[ée]es?|du\s+patient)\b/i,
      new RegExp(`\\brespect\\s+(?:de\\s+)?(?:son|votre|sa)\\s+autonomie\\b`, "i"),
    ],
    antiPattern: false,
  },
  "association de la famille avec accord du patient": {
    axis: "communication",
    category: "capacite_discernement",
    patterns: [
      /\bassocier\s+(?:la\s+)?famille\b/i,
      /\bavec\s+(?:votre\s+)?accord\b/i,
      /\bfamille\s+(?:peut\s+[êe]tre\s+)?associ[ée]e\b/i,
    ],
    antiPattern: false,
  },

  // must_avoid
  "question fermée « vous comprenez ? » (ne teste pas la compréhension)": {
    axis: "verbalisation",
    category: "capacite_discernement",
    patterns: [
      /\bvous\s+comprenez\s*\?/i,
      /\bvous\s+avez\s+(?:bien\s+)?compris\s*\?/i,
      /\b(?:c['’]?est|cela\s+est)\s+clair\s*\?/i,
    ],
    antiPattern: true,
  },
  "négation de l'autonomie résiduelle (famille décide à la place)": {
    axis: "communication",
    category: "capacite_discernement",
    patterns: [
      /\b(?:votre\s+)?famille\s+(?:doit\s+)?d[ée]cider?\s+[àa]\s+(?:votre|sa)\s+place\b/i,
      /\b(?:votre\s+)?famille\s+d[ée]cide\s+pour\s+vous\b/i,
      /\bce\s+n['’]?est\s+plus\s+[àa]\s+vous\s+de\s+d[ée]cider\b/i,
    ],
    antiPattern: true,
  },

  // ─────────────────────────────────────────────────────────────────
  // Phase 7 J1 — Catégorie C : directives_anticipees
  //   Cadre CH : CC-370 à CC-373 (directives anticipées), CC-360 à CC-369
  //   (mandat pour cause d'inaptitude), CC-377 à CC-381 (représentation
  //   thérapeutique en cas d'incapacité), CDM-art-4 (relation
  //   médecin-patient). Décision attendue : refer (recherche DA + respect
  //   + orientation conseil juridique). mandatory_reporting = false.
  // ─────────────────────────────────────────────────────────────────

  // must_verbalize
  "recherche de directives anticipées existantes (CC-370)": {
    axis: "reconnaissance",
    category: "directives_anticipees",
    patterns: [
      /\bdirectives?\s+anticip[ée]es?\b/i,
      /\bDA\b(?=[\s,.])/,
      /\bCC[\s\-]?370\b/i,
      /\b(?:art(?:icle)?\.?\s*)?370\s*CC\b/i,
    ],
    antiPattern: false,
  },
  "mandat pour cause d'inaptitude (CC-360)": {
    axis: "reconnaissance",
    category: "directives_anticipees",
    patterns: [
      new RegExp(`\\bmandat\\s+pour\\s+cause\\s+d${APOS}inaptitude\\b`, "i"),
      /\bCC[\s\-]?360\b/i,
      /\b(?:art(?:icle)?\.?\s*)?360\s*CC\b/i,
    ],
    antiPattern: false,
  },
  "représentation thérapeutique (CC-377 / CC-378)": {
    axis: "reconnaissance",
    category: "directives_anticipees",
    patterns: [
      /\brepr[ée]sentation\s+th[ée]rapeutique\b/i,
      /\brepr[ée]sentant\s+th[ée]rapeutique\b/i,
      /\bCC[\s\-]?377\b/i,
      /\bCC[\s\-]?378\b/i,
    ],
    antiPattern: false,
  },
  "ouverture du dialogue sur les volontés futures": {
    axis: "verbalisation",
    category: "directives_anticipees",
    patterns: [
      /\bavez[\s\-]vous\s+r[ée]dig[ée]\s+(?:des\s+)?directives?\s+anticip[ée]es?\b/i,
      /\bvos\s+volont[ée]s\s+(?:futures?|en\s+cas\s+de)\b/i,
      /\bqui\s+(?:souhaitez|voulez)[\s\-]vous\s+(?:comme\s+)?repr[ée]sentant\b/i,
      /\bsouhaitez[\s\-]vous\s+(?:en\s+)?(?:discuter|parler)\b/i,
    ],
    antiPattern: false,
  },
  "respect des volontés exprimées dans les directives": {
    axis: "decision",
    category: "directives_anticipees",
    patterns: [
      /\brespecter\s+(?:vos|les)\s+volont[ée]s\b/i,
      /\bvolont[ée]s\s+(?:sont\s+)?prioritaires\b/i,
      /\bappliquer\s+(?:vos|les)\s+directives\b/i,
    ],
    antiPattern: false,
  },
  "ordre légal de représentation à défaut de directives (CC-378)": {
    axis: "decision",
    category: "directives_anticipees",
    patterns: [
      /\bCC[\s\-]?378\b/i,
      /\bordre\s+l[ée]gal\s+(?:de\s+)?repr[ée]sentation\b/i,
      /\b[àa]\s+d[ée]faut\s+(?:de\s+)?directives?\b/i,
    ],
    antiPattern: false,
  },
  "orientation conseil juridique pour rédaction": {
    axis: "decision",
    category: "directives_anticipees",
    patterns: [
      /\bconseil\s+juridique\b/i,
      /\bnotaire\b/i,
      /\br[ée]daction\s+(?:des\s+)?directives\b/i,
      /\bformulaire\s+(?:officiel|FMH)\s+(?:de\s+)?directives\b/i,
    ],
    antiPattern: false,
  },
  "communication respectueuse sur les volontés évolutives": {
    axis: "communication",
    category: "directives_anticipees",
    patterns: [
      /\bdirectives\s+(?:peuvent|peut)\s+[ée]voluer\b/i,
      /\bvous\s+pouvez\s+(?:les\s+)?modifier\b/i,
      /\b[àa]\s+tout\s+moment\b/i,
      /\bvos\s+volont[ée]s\s+(?:sont\s+)?prioritaires\b/i,
    ],
    antiPattern: false,
  },

  // must_avoid
  "éviter le sujet des directives par gêne": {
    axis: "verbalisation",
    category: "directives_anticipees",
    patterns: [
      new RegExp(`\\bce\\s+n${APOS}?est\\s+pas\\s+le\\s+moment\\s+(?:d${APOS}?en\\s+parler)?\\b`, "i"),
      new RegExp(`\\bon\\s+en\\s+(?:re)?parlera\\s+plus\\s+tard\\b`, "i"),
      /\bpassons\s+[àa]\s+autre\s+chose\b/i,
      /\b[ée]vitons?\s+(?:ce\s+)?sujet\b/i,
    ],
    antiPattern: true,
  },
  "projeter ses propres valeurs sur les volontés du patient": {
    axis: "communication",
    category: "directives_anticipees",
    patterns: [
      /\b[àa]\s+votre\s+place\s+je\b/i,
      /\bmoi\s+je\s+ferais\b/i,
      /\bil\s+vaudrait\s+mieux\s+(?:choisir|d[ée]cider)\b/i,
      /\b(?:c['’]?est|c[ée]\s+serait)\s+mieux\s+(?:de|que)\b/i,
    ],
    antiPattern: true,
  },

  // ─────────────────────────────────────────────────────────────────
  // Phase 7 J1 — Catégorie D : responsabilite_teleconsult
  //   Cadre CH : CDM-art-3 al-3 (devoirs téléconsultation), CO-art-394 +
  //   CO-art-398 (mandat / devoir de moyens), LPD (données sensibles à
  //   distance), FMH directives télémédecine. Décision attendue : refer
  //   (orientation consultation physique en cas de doute, documentation
  //   horodatée, vérification d'identité, consigne de surveillance).
  //   mandatory_reporting = false.
  // ─────────────────────────────────────────────────────────────────

  // must_verbalize
  "limites de l'examen téléphonique reconnues": {
    axis: "reconnaissance",
    category: "responsabilite_teleconsult",
    patterns: [
      new RegExp(`\\blimites?\\s+(?:de\\s+)?(?:l${APOS})?examen\\s+(?:t[ée]l[ée]phonique|[àa]\\s+distance)\\b`, "i"),
      /\bje\s+ne\s+peux\s+pas\s+vous\s+examiner\s+(?:physiquement|en\s+personne)\b/i,
      /\bexamen\s+(?:partiel|incomplet|limit[ée])\b/i,
      new RegExp(`\\b[ée]valuation\\s+(?:partielle|incompl[èe]te|limit[ée]e)\\b`, "i"),
    ],
    antiPattern: false,
  },
  "vérification d'identité du patient à distance": {
    axis: "reconnaissance",
    category: "responsabilite_teleconsult",
    patterns: [
      new RegExp(`\\bv[ée]rification\\s+(?:de\\s+)?(?:l${APOS})?identit[ée]\\b`, "i"),
      /\bconfirmer\s+(?:votre\s+)?identit[ée]\b/i,
      /\bnom\s+(?:complet\s+)?(?:et\s+)?date\s+de\s+naissance\b/i,
      /\bv[ée]rifier\s+(?:que\s+)?(?:c['’]?est\s+)?bien\s+vous\b/i,
    ],
    antiPattern: false,
  },
  "consentement à la téléconsultation": {
    axis: "reconnaissance",
    category: "responsabilite_teleconsult",
    patterns: [
      new RegExp(`\\bconsentement\\s+(?:[àa]\\s+)?(?:la\\s+)?t[ée]l[ée]consultation\\b`, "i"),
      new RegExp(`\\baccord\\s+pour\\s+(?:cette\\s+)?(?:t[ée]l[ée])?consultation\\s+(?:[àa]\\s+distance)?\\b`, "i"),
      new RegExp(`\\b(?:[êe]tes|seriez)[\\s\\-]vous\\s+d${APOS}accord\\s+(?:pour|avec)\\s+(?:une\\s+)?(?:t[ée]l[ée])?consultation\\b`, "i"),
    ],
    antiPattern: false,
  },
  "consigne de surveillance écrite et red flags": {
    axis: "decision",
    category: "responsabilite_teleconsult",
    patterns: [
      /\bconsignes?\s+de\s+surveillance\b/i,
      /\bsi\s+(?:les\s+)?sympt[ôo]mes?\s+(?:s['’]?aggravent?|empirent?|persistent?)\b/i,
      /\bred\s+flags?\b/i,
      /\bsignes?\s+d['’]\s*alarme\b/i,
    ],
    antiPattern: false,
  },
  "orientation urgences ou consultation physique en cas de doute": {
    axis: "decision",
    category: "responsabilite_teleconsult",
    patterns: [
      /\borientation\s+(?:aux\s+)?urgences\b/i,
      /\bconsulter\s+(?:aux\s+)?urgences\b/i,
      /\bconsultation\s+physique\b/i,
      /\bvous\s+rendre?\s+aux\s+urgences\b/i,
      new RegExp(`\\bje\\s+vous\\s+propose\\s+(?:de\\s+)?(?:vous\\s+)?(?:voir|examiner)\\s+(?:en\\s+)?personne\\b`, "i"),
    ],
    antiPattern: false,
  },
  "documentation horodatée du contact": {
    axis: "decision",
    category: "responsabilite_teleconsult",
    patterns: [
      /\bdocumentation\s+horodat[ée]e\b/i,
      /\btracer\s+(?:la\s+)?(?:t[ée]l[ée])?consultation\b/i,
      /\bdate\s+(?:et\s+)?heure\s+(?:du\s+)?(?:contact|appel)\b/i,
      /\bnoter\s+(?:dans\s+(?:le\s+)?dossier|au\s+dossier)\s+(?:l['’]\s*)?(?:appel|contact)\b/i,
    ],
    antiPattern: false,
  },
  "explicitation des limites de la téléconsultation au patient": {
    axis: "verbalisation",
    category: "responsabilite_teleconsult",
    patterns: [
      /\bje\s+ne\s+peux\s+pas\s+vous\s+(?:voir|examiner)\b/i,
      /\bconsultation\s+[àa]\s+distance\b/i,
      /\bje\s+vous\s+propose\s+une\s+consultation\s+physique\b/i,
      /\bsi\s+(?:nous|on)\s+pouvi(?:o|e)ns\s+nous?\s+voir\b/i,
    ],
    antiPattern: false,
  },
  "transparence sur le caractère partiel de l'évaluation": {
    axis: "communication",
    category: "responsabilite_teleconsult",
    patterns: [
      new RegExp(`\\bcaract[èe]re\\s+(?:partiel|incomplet)\\s+(?:de\\s+)?(?:l${APOS})?[ée]valuation\\b`, "i"),
      new RegExp(`\\b[ée]valuation\\s+(?:reste\\s+)?(?:partielle|incompl[èe]te)\\b`, "i"),
      /\bje\s+ne\s+peux\s+pas\s+(?:tout\s+)?conclure\s+(?:[àa]\s+distance|sans\s+vous\s+voir)\b/i,
    ],
    antiPattern: false,
  },

  // must_avoid
  "prescription à distance sans documentation rigoureuse": {
    axis: "decision",
    category: "responsabilite_teleconsult",
    patterns: [
      /\bje\s+vous\s+prescris\s+(?:[àa]\s+distance\s+)?sans\s+(?:vous\s+)?(?:voir|examiner)\b/i,
      /\bprescrire\s+(?:[àa]\s+distance\s+)?sans\s+examen\b/i,
      /\bordonnance\s+(?:directe(?:ment)?\s+)?sans\s+(?:vous\s+)?voir\b/i,
    ],
    antiPattern: true,
  },
  "rappel ultérieur insuffisant face à un red flag": {
    axis: "decision",
    category: "responsabilite_teleconsult",
    patterns: [
      /\bje\s+vous\s+rappelle\s+dans\s+(?:une\s+)?semaine\b/i,
      new RegExp(`\\bon\\s+(?:se\\s+)?rappelle\\s+dans\\s+(?:quelques\\s+|une\\s+)?(?:semaine|jours)\\b`, "i"),
      /\battendez\s+(?:quelques\s+)?jours\s+(?:avant\s+de\s+)?(?:rappeler|reconsulter)\b/i,
    ],
    antiPattern: true,
  },
  "rassurance creuse sans examen": {
    axis: "communication",
    category: "responsabilite_teleconsult",
    patterns: [
      /\btout\s+va\s+bien,?\s+ne\s+vous\s+inqui[ée]tez\s+pas\b/i,
      /\bce\s+n['’]?est\s+(?:s[ûu]rement\s+)?rien\b/i,
      /\b[àa]\s+distance\s+je\s+peux\s+(?:vous\s+)?affirmer\b/i,
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

// Phase 7 J1 — Helper d'énumération des catégories couvertes par le
// lexique. Dérivé des entrées (et non d'une liste statique parallèle)
// pour éviter la dérive : si une entrée déclare une catégorie absente
// de `LEGAL_LEXICON_CATEGORIES`, le test d'invariant `legalLexicon
// catégorie déclarée valide` lève une erreur explicite.
export function listLegalLexiconCategories(): LegalLexiconCategory[] {
  const seen = new Set<LegalLexiconCategory>();
  for (const entry of Object.values(LEGAL_LEXICON)) {
    seen.add(entry.category);
  }
  return [...seen];
}

// ─── Phase 5 J3 — codes de loi, blacklist, directive prompt ──────────────
//
// Triple usage :
//   1. Boot guard : pour toute station avec legalContext, chaque code listé
//      dans `applicable_law` DOIT avoir une entrée ici. Si manquant, on
//      throw au boot avec un message clair (« missing lexicon mapping
//      for X »).
//   2. Blacklist directive injectée dans le prompt patient/accompagnant :
//      on liste les `humanLabel` correspondants pour que le LLM sache
//      explicitement quoi NE PAS dire.
//   3. Test de leak runtime : on applique les `detectPatterns` au system
//      prompt généré pour s'assurer qu'aucun code n'a fui.

export interface LegalLawCodeSpec {
  // Étiquette humaine injectée dans la directive (« art. 321 CP »).
  humanLabel: string;
  // Variantes regex défensives utilisées par les tests de leak runtime
  // (vérifient qu'aucun de ces patterns n'apparaît dans le system prompt
  // d'une station portant un legalContext).
  detectPatterns: RegExp[];
}

export const LEGAL_LAW_CODE_PATTERNS: Record<string, LegalLawCodeSpec> = {
  "CP-318": {
    humanLabel: "art. 318 CP (faux dans les titres)",
    detectPatterns: [
      /\bCP[\s\-]?318\b/,
      /\bart(?:icle)?\.?\s*318\b/i,
      /\bfaux\s+dans\s+les?\s+titres?\b/i,
    ],
  },
  "CP-321": {
    humanLabel: "art. 321 CP (secret professionnel)",
    detectPatterns: [
      /\bCP[\s\-]?321\b/,
      /\bart(?:icle)?\.?\s*321\b/i,
      /\bsecret\s+(?:professionnel|m[ée]dical)\b/i,
    ],
  },
  "CP-364": {
    humanLabel: "art. 364 CP (droit d'aviser)",
    detectPatterns: [
      /\bCP[\s\-]?364\b(?!\s*bis)/,
      /\bart(?:icle)?\.?\s*364\b(?!\s*bis)/i,
    ],
  },
  "CP-364bis": {
    humanLabel: "art. 364bis CP (devoir d'aviser pour mineurs)",
    detectPatterns: [
      /\bCP[\s\-]?364\s*bis\b/i,
      /\bart(?:icle)?\.?\s*364\s*bis\b/i,
      /\b364\s*bis\b/i,
    ],
  },
  "CC-307": {
    humanLabel: "art. 307 CC (mesures de protection de l'enfant)",
    detectPatterns: [
      /\bCC[\s\-]?307\b/,
      /\bart(?:icle)?\.?\s*307\b\s*CC\b/i,
    ],
  },
  "CC-314c": {
    humanLabel: "art. 314c CC (signalement à l'APEA mineur)",
    detectPatterns: [
      /\bCC[\s\-]?314\s*c\b/i,
      /\bart(?:icle)?\.?\s*314\s*c\b/i,
      /\b314\s*c\b/i,
    ],
  },
  "CC-443a": {
    humanLabel: "art. 443a CC (signalement à l'APEA adulte)",
    detectPatterns: [
      /\bCC[\s\-]?443\s*a\b/i,
      /\bart(?:icle)?\.?\s*443\s*a\b/i,
      /\b443\s*a\b/i,
    ],
  },
  "LAVI-art-1": {
    humanLabel: "LAVI art. 1 (loi sur l'aide aux victimes)",
    detectPatterns: [
      /\bLAVI\b/,
      /\baide\s+aux\s+victimes?\b/i,
    ],
  },
  "CDM-FMH-art-34": {
    humanLabel: "CDM art. 34 FMH (déontologie médicale)",
    detectPatterns: [
      /\bFMH\b/,
      /\bCDM\b/,
      /\bcode\s+de\s+d[ée]ontologie\b/i,
    ],
  },
  "CO-art-324a": {
    humanLabel: "art. 324a CO (paiement du salaire en cas d'empêchement)",
    detectPatterns: [
      /\bCO[\s\-]?324\s*a\b/i,
      /\bart(?:icle)?\.?\s*324\s*a\b/i,
      /\b324\s*a\b\s*CO\b/i,
    ],
  },
};

// Blacklist GÉNÉRIQUE de concepts juridiques transversaux qui s'applique
// à toute station portant un legalContext, indépendamment des codes
// `applicable_law` listés. Le patient/accompagnant ne doit JAMAIS citer
// spontanément ces termes — il décrit son vécu, ses émotions, ses faits,
// pas le cadre juridique.
//
// Format : { term: string (label affiché dans la directive),
//            detectPatterns: RegExp[] (utilisés par les tests de leak
//            runtime pour vérifier l'absence dans le prompt) }.
export interface LegalBlacklistTerm {
  term: string;
  detectPatterns: RegExp[];
}

export const LEGAL_BLACKLIST_TERMS: LegalBlacklistTerm[] = [
  {
    term: "secret professionnel / secret médical",
    detectPatterns: [/\bsecret\s+(?:professionnel|m[ée]dical|pro)\b/i],
  },
  {
    term: "signalement / signaler à l'APEA / aviser l'APEA",
    detectPatterns: [/\bAPEA\b/, /\bautorit[ée]\s+de\s+protection\b/i],
  },
  {
    term: "droit d'aviser / devoir d'aviser",
    detectPatterns: [
      /\b(?:droit|devoir)\s+d['’ʼ]aviser\b/i,
    ],
  },
  {
    term: "LAVI / aide aux victimes",
    detectPatterns: [/\bLAVI\b/, /\baide\s+aux\s+victimes?\b/i],
  },
  {
    term: "FMH / Fédération des médecins suisses",
    detectPatterns: [/\bFMH\b/],
  },
  {
    term: "CDM / Code de déontologie médicale",
    detectPatterns: [/\bCDM\b/, /\bcode\s+de\s+d[ée]ontologie\b/i],
  },
  {
    term: "faux dans les titres",
    detectPatterns: [/\bfaux\s+dans\s+les?\s+titres?\b/i],
  },
  {
    term: "responsabilité disciplinaire",
    detectPatterns: [/\b(?:responsabilit[ée]\s+)?disciplinaire\b/i],
  },
  {
    term: "certificat de complaisance",
    detectPatterns: [/\bcertificat\s+de\s+complaisance\b/i],
  },
  {
    term: "intérêt supérieur de l'enfant",
    detectPatterns: [/\bint[ée]r[êe]t\s+(?:sup[ée]rieur\s+)?de\s+l['’ʼ]enfant\b/i],
  },
  {
    term: "Code pénal (CP) / Code civil (CC) / article XXX",
    detectPatterns: [
      /\bCode\s+p[ée]nal\b/i,
      /\bCode\s+civil\b/i,
    ],
  },
];

// Construit la directive prompt à injecter quand la station a un
// `legalContext`. Combine :
//   • la blacklist générique (concepts transversaux),
//   • les `humanLabel` des codes listés dans `applicable_law` de cette
//     station (pour que le LLM ait une vue précise des codes spécifiques
//     à NE PAS citer pour CE scénario),
//   • un garde-fou sémantique : si le candidat invoque correctement le
//     cadre, le patient peut RÉAGIR (peur, soulagement, refus, acceptation)
//     mais ne CONFIRME JAMAIS le bon article ou la bonne décision.
//
// La directive est volontairement énumérative et formelle — c'est le
// format que le LLM respecte le mieux pour les contraintes négatives
// (cf. vocabularyConstraints.ts). 0 LLM dans cette construction : pure
// concaténation de tables statiques.
export function buildLegalLeakDirective(applicable_law: string[]): string {
  const stationCodeLabels = applicable_law
    .map((code) => LEGAL_LAW_CODE_PATTERNS[code]?.humanLabel)
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  const codeLines =
    stationCodeLabels.length > 0
      ? stationCodeLabels.map((l) => `- ❌ ${l}`).join("\n")
      : "- (aucun code spécifique listé pour cette station)";
  const genericLines = LEGAL_BLACKLIST_TERMS
    .map((t) => `- ❌ ${t.term}`)
    .join("\n");

  return `

## CADRE JURIDIQUE — INTERDICTIONS STRICTES (rôle patient·e / accompagnant·e)

Tu n'es PAS juriste. Tu n'es PAS soignant·e. Tu ne CONNAIS PAS les articles de loi qui s'appliquent à ta situation. Tu ne CITES JAMAIS spontanément, et tu ne CONFIRMES JAMAIS si le médecin les nomme correctement, les expressions juridiques suivantes :

### Codes de loi spécifiques à ta situation (ne jamais nommer, ne jamais confirmer) :
${codeLines}

### Concepts juridiques transversaux (ne jamais utiliser spontanément) :
${genericLines}

### Garde-fou sémantique (comportement si le médecin invoque le cadre légal) :
- Si le médecin invoque correctement le cadre légal (signalement, refus de certificat, secret pro), tu peux RÉAGIR ÉMOTIONNELLEMENT (peur, soulagement, colère, refus, acceptation, sidération) — c'est attendu.
- Tu ne dis JAMAIS « oui c'est l'article X » ou « vous avez raison de citer Y ». Tu ne CONFIRMES PAS la justesse du raisonnement juridique du médecin. Si on te demande explicitement « est-ce que je cite le bon article ? », tu réponds en patient·e : « je n'y connais rien, c'est vous le médecin ».
- Tu n'utilises pas non plus les acronymes institutionnels (APEA, LAVI, FMH, CDM) — tu peux à la rigueur dire « les services sociaux », « une association d'aide aux femmes », « votre ordre médical » si la conversation t'y mène, jamais l'acronyme officiel.

Règle générale : ton vocabulaire est celui d'un·e profane qui décrit son vécu (ce que tu RESSENS, ce qu'il t'est ARRIVÉ, ce que tu CRAINS), pas celui d'un·e juriste qui qualifie une situation.`;
}

// Garde-fou boot Phase 5 J3 : retourne la liste des codes de
// `applicable_law` qui ne sont PAS mappés dans LEGAL_LAW_CODE_PATTERNS.
// Si non vide, le validateur de catalogue throw avec un message clair.
export function findUnmappedLawCodes(applicable_law: string[]): string[] {
  return applicable_law.filter((code) => !(code in LEGAL_LAW_CODE_PATTERNS));
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
