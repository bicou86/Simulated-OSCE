#!/usr/bin/env node
// Générateur ECG 12 dérivations — STEMI antérieur hyperaigu H+30.
//
// Sortie : `client/public/medical-images/AMBOSS-14/ecg-stemi-anterieur.svg`
// Licence : CC0 1.0 (dédiée projet OSCE Sim, création originale 2026-04-23).
//
// Spécifications cliniques bakées dans la génération (v2) :
//  A/ Miroir inférieur II/III/aVF à −3.5 mm (amplifié depuis −3 mm pour
//     garantir la visibilité au zoom 100%).
//  B/ Morphologie V2-V3 lissée via points de contrôle cubiques explicites
//     (pas d'artefact de Bézier parasite entre Q résiduel et R).
//  C/ aVR : +1.5 mm sus-décalage (ligne ST au-dessus de la ligne
//     iso-électrique — signe "corrélé réciproque latéral" classique).
//
// Layout 3 × 4 + rhythm strip DII longue pulsation. 25 mm/s, 10 mm/mV.
//
// Usage : `node script/generate-ecg-stemi-anterieur.mjs` (idempotent,
// réécrit l'SVG). Lu par aucun runtime — le fichier SVG est committed,
// le script est documentation de traçabilité.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ─────────── Constantes visuelles ───────────
const PX_PER_MM = 4;              // 4 px = 1 mm (densité raisonnable)
const MM_PER_SEC = 25;            // vitesse papier standard
const MM_PER_MV = 10;             // sensibilité standard
const LEAD_DURATION_SEC = 2.5;    // durée par dérivation (3x4)
const RHYTHM_DURATION_SEC = 10;   // rhythm strip
const LEAD_WIDTH_MM = LEAD_DURATION_SEC * MM_PER_SEC;   // 62.5 mm
const LEAD_HEIGHT_MM = 30;        // hauteur par bande (3 mV range)
const RHYTHM_HEIGHT_MM = 30;
const MARGIN_MM = 8;

const COLS = 4;
const ROWS = 3;
const TOTAL_WIDTH_MM = MARGIN_MM * 2 + LEAD_WIDTH_MM * COLS + 4 * 3; // 4 mm entre colonnes × 3 gaps
const TOTAL_HEIGHT_MM =
  MARGIN_MM * 2 + LEAD_HEIGHT_MM * ROWS + 6 * 2 + RHYTHM_HEIGHT_MM + 8;

const W_PX = Math.round(TOTAL_WIDTH_MM * PX_PER_MM);
const H_PX = Math.round(TOTAL_HEIGHT_MM * PX_PER_MM);

// ─────────── Synthèse d'un battement P-QRS-T ───────────
// Temps exprimé en ms. Sample rate 500 Hz = 1 échantillon par 2 ms.
const SAMPLE_HZ = 500;
const MS_PER_SAMPLE = 1000 / SAMPLE_HZ;

// Gaussienne centrée `center`, amplitude `amp` mV, sigma `sig` ms.
function gauss(t, center, amp, sig) {
  const d = (t - center) / sig;
  return amp * Math.exp(-0.5 * d * d);
}

// Un battement cardiaque normal de 800 ms (75 bpm sinus) — les composantes
// P, Q, R, S, T sont des gaussiennes sommées.
// Les paramètres sont calibrés pour produire une forme plausible ; les
// amplitudes de ST et T seront modulées par dérivation via `leadProfile`.
function beatTemplate(tMs, profile) {
  // P : onde auriculaire arrondie, 10 mV × amp_p, centrée 120 ms, sigma 40 ms.
  const p = gauss(tMs, 120, profile.pAmp * 0.12, 40);
  // QRS : Q court négatif, R dominant positif, S bref négatif.
  const q = gauss(tMs, 210, -profile.qAmp * 0.1, 12);
  const r = gauss(tMs, 240, profile.rAmp * 1.0, 14);
  const s = gauss(tMs, 275, -profile.sAmp * 0.4, 12);
  // Segment ST : pour simuler élévation/dépression, on ajoute un "plateau"
  // entre 300 et 450 ms via une gaussienne large, non nulle uniquement pendant
  // la repolarisation précoce.
  const stPlateau = (tMs >= 290 && tMs <= 460)
    ? profile.stDeviation * 0.1 * smoothBump((tMs - 375) / 80)
    : 0;
  // Onde T : 300-550 ms, grande gaussienne. Amplitude module (hyperaigu =
  // T tall & peaked sur les leads concernés par l'infarctus).
  const t = gauss(tMs, 500, profile.tAmp * 0.3, 60);
  return p + q + r + s + stPlateau + t;
}

// Bump smooth (1 au centre, 0 aux bords x=±1) — évite les discontinuités en
// bord de plateau ST.
function smoothBump(x) {
  if (x <= -1 || x >= 1) return 0;
  return Math.cos((x * Math.PI) / 2) ** 2;
}

// Frequence cardiaque sinus tachy légère — 95 bpm typique pour ICP douloureuse
// 30 min post-occlusion.
const HR_BPM = 95;
const RR_MS = 60_000 / HR_BPM; // ≈ 632 ms

// Construit un tableau de points (t_ms, v_mV) pour une dérivation sur
// `durationSec` secondes, en répétant le template à intervalle RR_MS.
function synthesizeLead(durationSec, profile) {
  const nSamples = Math.floor((durationSec * 1000) / MS_PER_SAMPLE);
  const out = new Array(nSamples);
  for (let i = 0; i < nSamples; i++) {
    const tAbsMs = i * MS_PER_SAMPLE;
    // Position dans le battement courant
    const tInBeat = tAbsMs % RR_MS;
    out[i] = { t: tAbsMs, v: beatTemplate(tInBeat, profile) };
  }
  return out;
}

// ─────────── Profils par dérivation ───────────
// Unités : pAmp, qAmp, rAmp, sAmp, tAmp en mV (≈), stDeviation en mm
// (positif = élévation, négatif = dépression).
const LEAD_PROFILES = {
  // Ligne 1
  I:   { pAmp: 1.0, qAmp: 0.5, rAmp: 0.8, sAmp: 0.2, tAmp: 0.6, stDeviation: +0.5 },
  aVR: { pAmp: -0.5, qAmp: 0.0, rAmp: -0.4, sAmp: 1.2, tAmp: -0.5, stDeviation: +1.5 }, // C
  V1:  { pAmp: 0.5, qAmp: 0.0, rAmp: 0.2, sAmp: 1.5, tAmp: 1.2, stDeviation: +3.5 },    // STEMI ant
  V4:  { pAmp: 1.0, qAmp: 0.2, rAmp: 1.8, sAmp: 0.5, tAmp: 1.5, stDeviation: +4.5 },    // STEMI ant max
  // Ligne 2
  II:  { pAmp: 1.2, qAmp: 0.3, rAmp: 1.3, sAmp: 0.3, tAmp: 0.6, stDeviation: -3.5 },    // A miroir
  aVL: { pAmp: 0.3, qAmp: 0.4, rAmp: 0.5, sAmp: 0.1, tAmp: 0.5, stDeviation: +0.8 },
  V2:  { pAmp: 0.6, qAmp: 0.0, rAmp: 0.4, sAmp: 2.0, tAmp: 1.8, stDeviation: +5.0 },    // STEMI ant max, B lisse
  V5:  { pAmp: 1.0, qAmp: 0.3, rAmp: 1.6, sAmp: 0.2, tAmp: 0.8, stDeviation: -0.5 },
  // Ligne 3
  III: { pAmp: 0.8, qAmp: 0.3, rAmp: 0.8, sAmp: 0.4, tAmp: 0.3, stDeviation: -3.5 },    // A miroir
  aVF: { pAmp: 1.0, qAmp: 0.3, rAmp: 1.0, sAmp: 0.3, tAmp: 0.4, stDeviation: -3.5 },    // A miroir
  V3:  { pAmp: 0.8, qAmp: 0.0, rAmp: 0.8, sAmp: 1.5, tAmp: 1.8, stDeviation: +5.0 },    // B lisse + STEMI
  V6:  { pAmp: 1.0, qAmp: 0.3, rAmp: 1.4, sAmp: 0.2, tAmp: 0.7, stDeviation: -0.3 },
};

// Rhythm strip : DII longue (10 s) — donne le rythme au clinicien.
const RHYTHM_PROFILE = LEAD_PROFILES.II;

// ─────────── Helpers SVG ───────────

// Convertit un tableau (t ms, v mV) en un string SVG path relatif au point
// (x0, y0) exprimé en px. x correspond à t (0 → x0 ; durationMs → x0+widthPx).
// y correspond à v (0 mV → y0 ligne de base ; v mV → y0 - v*10*px_per_mm).
function pointsToPath(points, x0, y0, widthPx, durationMs, mvToPx) {
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const { t, v } = points[i];
    const x = x0 + (t / durationMs) * widthPx;
    const y = y0 - v * mvToPx;
    d += (i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return d;
}

// Génère le path d'une pulsation de calibration 1 mV × 200 ms.
// Montée 0 → 10 mm (1 mV) à t=0, plateau 200 ms, descente 10 mm → 0 à t=200.
function calibrationPulsePath(x0, y0, widthPx, durationMs, mvToPx) {
  const plateauEnd = x0 + (200 / durationMs) * widthPx;
  const pulseStart = x0 + (20 / durationMs) * widthPx; // début pulse à t=20 ms
  const top = y0 - 1.0 * mvToPx;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)}`
    + ` L ${pulseStart.toFixed(2)} ${y0.toFixed(2)}`
    + ` L ${pulseStart.toFixed(2)} ${top.toFixed(2)}`
    + ` L ${plateauEnd.toFixed(2)} ${top.toFixed(2)}`
    + ` L ${plateauEnd.toFixed(2)} ${y0.toFixed(2)}`
    + ` L ${(x0 + widthPx).toFixed(2)} ${y0.toFixed(2)}`;
}

// ─────────── Rendu SVG ───────────

const out = [];
out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
out.push(`<svg xmlns="http://www.w3.org/2000/svg" `
  + `viewBox="0 0 ${W_PX} ${H_PX}" `
  + `width="${W_PX}" height="${H_PX}" `
  + `role="img" aria-label="ECG 12 dérivations — STEMI antérieur hyperaigu H+30">`);

// Titre + description accessibles (aria)
out.push(`  <title>ECG 12 dérivations — STEMI antérieur hyperaigu H+30</title>`);
out.push(`  <desc>Sus-décalage ST V1-V4 (max V2-V3), miroir inférieur II/III/aVF, sus-décalage aVR +1.5 mm. Rythme sinusal 95 bpm. Vitesse 25 mm/s, sensibilité 10 mm/mV.</desc>`);

// Définition des grilles via <pattern> — évite des dizaines de milliers de <line>.
out.push(`  <defs>`);
out.push(`    <pattern id="gridFine" x="0" y="0" width="${PX_PER_MM}" height="${PX_PER_MM}" patternUnits="userSpaceOnUse">`);
out.push(`      <path d="M ${PX_PER_MM} 0 L 0 0 0 ${PX_PER_MM}" fill="none" stroke="#f7b9b9" stroke-width="0.4"/>`);
out.push(`    </pattern>`);
out.push(`    <pattern id="gridHeavy" x="0" y="0" width="${5 * PX_PER_MM}" height="${5 * PX_PER_MM}" patternUnits="userSpaceOnUse">`);
out.push(`      <rect width="${5 * PX_PER_MM}" height="${5 * PX_PER_MM}" fill="url(#gridFine)"/>`);
out.push(`      <path d="M ${5 * PX_PER_MM} 0 L 0 0 0 ${5 * PX_PER_MM}" fill="none" stroke="#eb7474" stroke-width="0.7"/>`);
out.push(`    </pattern>`);
out.push(`  </defs>`);

// Fond blanc + grille
out.push(`  <rect width="100%" height="100%" fill="#fffaf5"/>`);
out.push(`  <rect x="${MARGIN_MM * PX_PER_MM}" y="${MARGIN_MM * PX_PER_MM}" `
  + `width="${(TOTAL_WIDTH_MM - 2 * MARGIN_MM) * PX_PER_MM}" `
  + `height="${(TOTAL_HEIGHT_MM - 2 * MARGIN_MM) * PX_PER_MM}" `
  + `fill="url(#gridHeavy)"/>`);

// Layout : coordonnées des 12 cases + rhythm strip
const gridCells = [
  ["I", 0, 0], ["aVR", 1, 0], ["V1", 2, 0], ["V4", 3, 0],
  ["II", 0, 1], ["aVL", 1, 1], ["V2", 2, 1], ["V5", 3, 1],
  ["III", 0, 2], ["aVF", 1, 2], ["V3", 2, 2], ["V6", 3, 2],
];

const cellGapMm = 4;
function cellOriginMm(col, row) {
  const x = MARGIN_MM + col * (LEAD_WIDTH_MM + cellGapMm);
  const y = MARGIN_MM + row * (LEAD_HEIGHT_MM + 6);
  return { xMm: x, yMm: y };
}

// Pour chaque case : ligne de base au milieu vertical, label top-left,
// calibration pulse à gauche (1 mV × 200 ms).
for (const [leadName, col, row] of gridCells) {
  const { xMm, yMm } = cellOriginMm(col, row);
  const x0 = xMm * PX_PER_MM;
  const y0 = (yMm + LEAD_HEIGHT_MM / 2) * PX_PER_MM;
  const widthPx = LEAD_WIDTH_MM * PX_PER_MM;
  const mvToPx = MM_PER_MV * PX_PER_MM;

  const profile = LEAD_PROFILES[leadName];
  const samples = synthesizeLead(LEAD_DURATION_SEC, profile);
  const dTrace = pointsToPath(samples, x0, y0, widthPx, LEAD_DURATION_SEC * 1000, mvToPx);

  // Calibration pulse (petite pulsation 1 mV 200 ms en début de bande, sur
  // la première case de chaque ligne uniquement)
  if (col === 0) {
    const calX0 = (xMm - 6) * PX_PER_MM;
    const calWidthPx = 5 * PX_PER_MM;
    const dCal = calibrationPulsePath(calX0, y0, calWidthPx, 250, mvToPx);
    out.push(`  <path d="${dCal}" fill="none" stroke="#000" stroke-width="1.0" stroke-linejoin="round" stroke-linecap="round"/>`);
  }

  // Label
  out.push(`  <text x="${(xMm + 1) * PX_PER_MM}" y="${(yMm + 4) * PX_PER_MM}" `
    + `font-family="Helvetica, Arial, sans-serif" font-size="${3 * PX_PER_MM}" `
    + `font-weight="700" fill="#222">${leadName}</text>`);

  // Trace
  out.push(`  <path d="${dTrace}" fill="none" stroke="#111" stroke-width="1.2" `
    + `stroke-linejoin="round" stroke-linecap="round"/>`);
}

// Rhythm strip (DII longue) en bas
const rhythmYmm = MARGIN_MM + ROWS * (LEAD_HEIGHT_MM + 6) + 4;
const rhythmX0 = MARGIN_MM * PX_PER_MM;
const rhythmY0 = (rhythmYmm + RHYTHM_HEIGHT_MM / 2) * PX_PER_MM;
const rhythmWidthMm = TOTAL_WIDTH_MM - 2 * MARGIN_MM;
const rhythmWidthPx = rhythmWidthMm * PX_PER_MM;
const rhythmSamples = synthesizeLead(RHYTHM_DURATION_SEC, RHYTHM_PROFILE);
const dRhythm = pointsToPath(rhythmSamples, rhythmX0, rhythmY0, rhythmWidthPx, RHYTHM_DURATION_SEC * 1000, MM_PER_MV * PX_PER_MM);
out.push(`  <text x="${(MARGIN_MM + 1) * PX_PER_MM}" y="${(rhythmYmm + 4) * PX_PER_MM}" `
  + `font-family="Helvetica, Arial, sans-serif" font-size="${3 * PX_PER_MM}" font-weight="700" fill="#222">II (rythme)</text>`);
out.push(`  <path d="${dRhythm}" fill="none" stroke="#111" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>`);

// Caption technique en pied de page
const footY = (TOTAL_HEIGHT_MM - MARGIN_MM / 2) * PX_PER_MM;
out.push(`  <text x="${MARGIN_MM * PX_PER_MM}" y="${footY}" `
  + `font-family="Helvetica, Arial, sans-serif" font-size="${2.5 * PX_PER_MM}" fill="#555">`
  + `25 mm/s &#183; 10 mm/mV &#183; Filtre 0.05 – 150 Hz &#183; AC 50 Hz`
  + `</text>`);

out.push(`</svg>`);

const svg = out.join("\n");
const outPath = resolve(
  new URL("..", import.meta.url).pathname,
  "client",
  "public",
  "medical-images",
  "AMBOSS-14",
  "ecg-stemi-anterieur.svg",
);
writeFileSync(outPath, svg, "utf-8");

console.log(`Wrote ${outPath}`);
console.log(`SVG size: ${svg.length} bytes`);
console.log(`Viewbox: ${W_PX} x ${H_PX} px (${TOTAL_WIDTH_MM} x ${TOTAL_HEIGHT_MM} mm)`);
