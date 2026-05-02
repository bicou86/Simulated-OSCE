/**
 * Phase 10 J2 — Diagnostic runtime impact dette 3 sur transcript
 * synthétique RESCOS-64-P2.
 *
 * Mesure l'écart de weightedScore selon les 3 stratégies de gestion
 * négation considérées au cadrage Q-N5 :
 *   • detectPreJ2 : substring + 60 % keywords (pré-tokenizer J1)
 *   • detectJ1    : token-based brut (J1, sans gestion négation)
 *   • detectOptC  : token-based + négation transcript-only (option C)
 *   • detectOptA  : token-based + négation symétrique (option A-strict)
 *
 * A servi à choisir A-strict en J2 (cf. commit J2 message + spec
 * Q-N5 finale). Les chiffres exacts produits par ce script ont
 * été l'arbitrage runtime entre 100 (J1), 87.89 (option C), 97.97
 * (estimation A simulation) et 95.61 (mesure runtime A-strict
 * via tests vitest sur l'algo réel). L'écart 97.97 / 95.61 vient de
 * la pollution inter-items : ce script ne couvre que les 8 items à
 * marqueurs explicites, pas les 3 items « clean » p9/r4/r13 pénalisés
 * par les marqueurs voisins via la concaténation parts.join(". ").
 *
 * Conservé pour reproductibilité / audit Phase 11+ si la dette
 * « Désambiguïsation positionnelle keywords partagés » (A-positional)
 * est portée.
 *
 * Usage : node scripts/diagnostics/phase10J2_negationImpact.cjs
 */

const fs = require("fs");
const d = JSON.parse(fs.readFileSync("/home/runner/workspace/server/data/evaluator/Examinateur_RESCOS_4.json", "utf-8"));
const station = d.stations.find((s) => s.id && s.id.includes("Station double 2"));

const NEG_MARKERS = new Set([
  "pas", "non", "ni", "sans", "jamais", "aucun", "aucune", "aucuns", "aucunes",
  "absence", "absent", "absente", "absents", "absentes",
  "negatif", "negative", "negatifs", "negatives",
  "exclu", "exclue", "exclus", "exclues",
  "nie", "nient",
]);
const STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "au", "aux",
  "pour", "contre", "avec", "sans", "dans", "sur", "ou", "et", "est",
  "pas", "ne", "ni", "par", "cette", "ces", "son", "sa", "ses",
  "diagnostic", "patient", "argument", "elements", "element",
]);
const MIN = 4, THRESH = 0.6, WIN = 4;

function normalize(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function tokenize(s) { return normalize(s).split(/\s+/).filter((t) => t.length > 0); }
function isNegatedAt(tokens, pos) {
  const start = Math.max(0, pos - WIN);
  for (let i = start; i < pos; i++) if (NEG_MARKERS.has(tokens[i])) return true;
  return false;
}
function isNegatedAny(keyword, tokens) {
  const positions = [];
  for (let i = 0; i < tokens.length; i++) if (tokens[i] === keyword) positions.push(i);
  if (positions.length === 0) return false;
  return positions.every((p) => isNegatedAt(tokens, p));
}

// Reconstruire le transcript parfait (logique exacte du test Phase 8 J3 ligne 377-414)
const parts = [];
for (const axis of ["presentation", "raisonnement", "examens", "management"]) {
  for (const it of (station.grille[axis] || [])) {
    const att = (it.items_attendus || [])[0];
    if (att && /^aucun$/i.test(att.trim())) continue;
    if (it.binaryOnly === true && (!it.items_attendus || it.items_attendus.length === 0) && axis === "raisonnement") {
      const m = /Diagnostic[^:]+:\s*(.+)$/i.exec(it.text);
      if (m) parts.push(m[1].trim());
      continue;
    }
    if (!att) continue;
    parts.push(att);
    if (it.scoringRule && it.binaryOnly !== true) {
      const clauses = it.scoringRule.split(",").map((s) => s.trim());
      const tokens = clauses.filter((c) => {
        const m = /^(.+?)\s*=\s*([\d.]+)\s*pt/i.exec(c);
        if (!m) return false;
        const left = m[1].trim();
        if (/^pas fait$/i.test(left) || /^fait$/i.test(left) || left === "±") return false;
        if (/^\d/.test(left)) return false;
        return true;
      }).map((c) => /^(.+?)\s*=/.exec(c)[1].trim());
      for (const tk of tokens) parts.push(tk);
    }
  }
}
const transcript = parts.join(". ") + ".";
const transTokens = tokenize(transcript);

console.log("Transcript parfait : " + transTokens.length + " tokens, " + transcript.length + " caractères\n");

// Détection options
function detectPreJ2(sub, transcript) {
  const normItem = normalize(sub);
  const normTrans = normalize(transcript);
  if (normItem.length === 0) return false;
  if (normTrans.includes(normItem)) return true;
  const kw = normItem.split(/\s+/).filter((w) => w.length >= MIN && !STOPWORDS.has(w));
  if (kw.length === 0) return normTrans.includes(normItem);
  const matched = kw.filter((k) => normTrans.includes(k));
  return matched.length >= Math.ceil(kw.length * THRESH);
}
function detectJ1(sub, transTokens) {
  const itTok = tokenize(sub);
  if (itTok.length === 0) return false;
  const transSet = new Set(transTokens);
  const kw = itTok.filter((t) => t.length >= MIN && !STOPWORDS.has(t));
  if (kw.length === 0) return itTok.every((t) => transSet.has(t));
  const matched = kw.filter((k) => transSet.has(k));
  return matched.length >= Math.ceil(kw.length * THRESH);
}
function detectOptC(sub, transTokens) {
  const itTok = tokenize(sub);
  if (itTok.length === 0) return false;
  const transSet = new Set(transTokens);
  const kw = itTok.filter((t) => t.length >= MIN && !STOPWORDS.has(t));
  if (kw.length === 0) {
    return itTok.every((t) => transSet.has(t) && !isNegatedAny(t, transTokens));
  }
  const matched = kw.filter((k) => transSet.has(k) && !isNegatedAny(k, transTokens));
  return matched.length >= Math.ceil(kw.length * THRESH);
}
function detectOptA(sub, transTokens) {
  const itTok = tokenize(sub);
  if (itTok.length === 0) return false;
  const transSet = new Set(transTokens);
  const kw = itTok.filter((t) => t.length >= MIN && !STOPWORDS.has(t));
  if (kw.length === 0) {
    return itTok.every((t) => {
      if (!transSet.has(t)) return false;
      return isNegatedAny(t, itTok) === isNegatedAny(t, transTokens);
    });
  }
  const matched = kw.filter((k) => {
    if (!transSet.has(k)) return false;
    return isNegatedAny(k, itTok) === isNegatedAny(k, transTokens);
  });
  return matched.length >= Math.ceil(kw.length * THRESH);
}

const targets = [
  { axis: "presentation", id: "p6", csv: ["Possible BPCO non investigué (sur refus de la patiente)"], mode: "binary" },
  { axis: "presentation", id: "p8", csv: ["Afébrile", "pas de sudations"], mode: "beta" },
  { axis: "presentation", id: "p15", csv: ["Réalise ne pas avoir cherché certains éléments pertinents dans l'anamnèse et /ou l'examen clinique et les mentionne"], mode: "binary" },
  { axis: "raisonnement", id: "r3", csv: ["Absence de fatigue"], mode: "beta" },
  { axis: "raisonnement", id: "r6", csv: ["Pas de fièvre", "pas de facteurs de risque (cortisone)", "pas d'antécédent", "pas de TBC dans la famille"], mode: "count(4-2=2)" },
  { axis: "raisonnement", id: "r9", csv: ["Pas de voyage", "pas d'immobilité", "pas de TVP", "pas d'ATCD d'EP"], mode: "count(4-3=2)" },
  { axis: "raisonnement", id: "r12", csv: ["Pas de changement de couleur/quantité des expectorations", "pas de fièvre"], mode: "beta" },
  { axis: "raisonnement", id: "r15", csv: ["Pas de problème cardiaque connu", "pas de souffle cardiaque", "pas de rhumatisme articulaire aigu"], mode: "beta" },
];

console.log("Sub-item matched par option (preJ2 = avant tokenizer ; J1 = post-J1 sans negation ; optC/optA = J2)");
console.log("─".repeat(96));
for (const t of targets) {
  const r = t.csv.map((s) => ({
    sub: s,
    pre: detectPreJ2(s, transcript),
    j1: detectJ1(s, transTokens),
    c: detectOptC(s, transTokens),
    a: detectOptA(s, transTokens),
  }));
  console.log("\n" + t.axis + "/" + t.id + " (" + t.mode + ")");
  for (const sr of r) {
    console.log("  " + JSON.stringify(sr.sub).padEnd(70) + " preJ2=" + sr.pre + " J1=" + sr.j1 + " optC=" + sr.c + " optA=" + sr.a);
  }
  const counts = (k) => r.filter((s) => s[k]).length;
  console.log("  ─ totaux : preJ2=" + counts("pre") + "/" + r.length + " J1=" + counts("j1") + "/" + r.length + " optC=" + counts("c") + "/" + r.length + " optA=" + counts("a") + "/" + r.length);
}

// Synthèse globale impact transcript-parfait
function gridScore(getDetect) {
  let totalScore = 0, totalMax = 0;
  const axisScores = {};
  for (const axis of ["presentation", "raisonnement", "examens", "management"]) {
    let aScore = 0, aMax = 0;
    for (const it of (station.grille[axis] || [])) {
      const att = (it.items_attendus || [])[0];
      // skip silent r14
      if (att && /^aucun$/i.test(att.trim())) continue;
      if (!att) continue;
      const csvSub = att.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      // binaryOnly:true → 1 sub-item, score 1/0, max 1
      if (it.binaryOnly === true) {
        const ok = getDetect(csvSub[0], transTokens, transcript);
        aScore += ok ? 1 : 0;
        aMax += 1;
        continue;
      }
      // binaryOnly:false avec scoringRule
      if (it.scoringRule) {
        // mode count : matched=count of sub matched, applique reachable
        const matched = csvSub.filter((s) => getDetect(s, transTokens, transcript)).length;
        const expected = csvSub.length;
        // parse rule
        const clauses = it.scoringRule.split(",").map((s) => s.trim());
        const steps = [];
        let isToken = false;
        for (const c of clauses) {
          const m = /^(.+?)\s*=\s*([\d.]+)\s*pt/i.exec(c);
          if (!m) continue;
          const left = m[1].trim(); const points = parseFloat(m[2]);
          let count = null;
          if (/^pas fait$/i.test(left)) count = 0;
          else if (/^fait$/i.test(left)) count = 1;
          else if (left === "±") count = 1;
          else { const r = /^(\d+)(?:\s*[-–]\s*(\d+))?/.exec(left); if (r) { count = Math.min(parseInt(r[1]), r[2] !== undefined ? parseInt(r[2]) : parseInt(r[1])); } }
          if (count !== null) steps.push({ kind: "count", count, points });
          else { steps.push({ kind: "token", token: left, points }); isToken = true; }
        }
        if (isToken) {
          // mode token
          const tokenSteps = steps.filter((s) => s.kind === "token");
          const max = tokenSteps.reduce((s, t) => s + t.points, 0);
          const score = tokenSteps.reduce((s, t) => s + (getDetect(t.token, transTokens, transcript) ? t.points : 0), 0);
          aScore += score; aMax += max;
        } else {
          const counts = steps.filter((s) => s.kind === "count").sort((a, b) => b.count - a.count);
          const reachable = counts.filter((s) => s.count <= expected);
          if (reachable.length === 0) { aScore += 0; aMax += 0; continue; }
          const max = reachable.reduce((m, s) => Math.max(m, s.points), 0);
          let score = 0;
          for (const step of reachable) { if (matched >= step.count) { score = step.points; break; } }
          aScore += score; aMax += max;
        }
        continue;
      }
      // β fractional
      const matched = csvSub.filter((s) => getDetect(s, transTokens, transcript)).length;
      const expected = csvSub.length;
      aScore += expected > 0 ? matched / expected : 0;
      aMax += 1;
    }
    axisScores[axis] = { score: aScore, max: aMax, normalized: aMax > 0 ? Math.min(1, aScore / aMax) : 0 };
    totalScore += axisScores[axis].normalized * 0.25;
  }
  return { axisScores, weightedScore: Math.round(totalScore * 100 * 100) / 100 };
}

console.log("\n" + "═".repeat(96));
console.log("Score global transcript parfait :");
console.log("  J1 actuel  : " + gridScore((sub) => detectJ1(sub, transTokens)).weightedScore);
console.log("  Option C   : " + gridScore((sub) => detectOptC(sub, transTokens)).weightedScore);
console.log("  Option A   : " + gridScore((sub) => detectOptA(sub, transTokens)).weightedScore);
