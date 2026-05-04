// Document PDF du rapport d'évaluation OSCE.
// Rendu structuré : page 1 = synthèse visuelle (score global + 4 axes avec
// barres), pages suivantes = détail (tableaux d'items, sections narratives)
// avec palette de couleurs pédagogiques cohérente avec l'affichage web.

import React from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { EvaluationScores } from "@/lib/api";
import { stripRedundantSections, classifyStatusCell } from "@/lib/reportFormatting";
import { type AccentKind, tokenizeAccents } from "@/lib/reportAccents";
import type {
  PedagogicalContent,
  PedagogicalImage,
  PedagogicalSubsection,
  PedagogicalTree,
} from "@shared/pedagogical-content-schema";

// ─────────── Palette centralisée ───────────

const colors = {
  primary: "#2563eb",
  primarySoft: "#dbeafe",
  red: "#b91c1c",
  redSoft: "#fee2e2",
  emerald: "#047857",
  emeraldSoft: "#d1fae5",
  amber: "#b45309",
  amberSoft: "#fef3c7",
  indigo: "#4338ca",
  indigoSoft: "#e0e7ff",
  text: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  background: "#ffffff",
};

// Exporté pour permettre aux tests de vérifier la conformité des styles
// — notamment la régression J4-hotfix sur `pedagogyImage` qui doit
// strictement utiliser `width` (et pas `maxWidth`/`maxHeight`/`objectFit`,
// ignorés par @react-pdf/renderer et source de NaN/Infinity Yoga).
export const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: colors.text,
    lineHeight: 1.45,
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
    paddingBottom: 10,
    marginBottom: 16,
  },
  headerTitle: { fontSize: 18, fontFamily: "Helvetica-Bold", color: colors.text },
  headerMeta: { fontSize: 9.5, color: colors.muted, marginTop: 2 },

  // Page 1 — bloc score global
  globalBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 16,
    marginBottom: 18,
  },
  globalScore: { fontSize: 44, fontFamily: "Helvetica-Bold" },
  globalMeta: { flex: 1, marginLeft: 18 },
  verdictLabel: { fontSize: 10, color: colors.muted, marginBottom: 2 },
  verdictValue: { fontSize: 18, fontFamily: "Helvetica-Bold" },

  // Tableau synthèse des axes
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: colors.text,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  axisTable: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 14,
  },
  axisHeaderRow: {
    flexDirection: "row",
    backgroundColor: colors.primarySoft,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  axisHeaderCell: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  axisRow: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: "center",
  },
  axisName: { flex: 2.4, fontSize: 10 },
  axisWeight: { flex: 0.8, fontSize: 10, fontFamily: "Courier", color: colors.muted },
  axisRaw: { flex: 0.8, fontSize: 10, fontFamily: "Courier" },
  axisPercent: { flex: 0.8, fontSize: 10, fontFamily: "Courier", fontWeight: "bold" },
  axisBarWrap: {
    flex: 2,
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: "hidden",
  },
  axisBarFill: { height: 8, borderRadius: 4 },

  // Bandes de section
  sectionBanner: {
    padding: 10,
    borderRadius: 4,
    marginTop: 18,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionBannerTitle: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  sectionBannerMeta: { fontSize: 10, fontFamily: "Courier" },

  // Tableaux d'items
  itemTable: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 10,
  },
  itemHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  itemHeaderCell: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  itemRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: 6,
    alignItems: "flex-start",
  },
  itemIdCell: { width: 34, fontFamily: "Courier", fontSize: 9, color: colors.muted },
  itemTextCell: { flex: 2.5, fontSize: 9.5, paddingRight: 6 },
  itemStatusCell: {
    width: 60,
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 4,
    alignItems: "center",
  },
  itemStatusText: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  itemCommentCell: { flex: 3, fontSize: 9.5, paddingLeft: 6 },

  // Paragraphes narratifs
  heading2: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    marginTop: 14,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  heading3: { fontSize: 11.5, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 4 },
  paragraph: { fontSize: 10, marginBottom: 6 },
  listItem: { flexDirection: "row", marginBottom: 3, marginLeft: 4 },
  listBullet: { width: 10, fontSize: 10 },
  listText: { flex: 1, fontSize: 10 },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    backgroundColor: colors.primarySoft,
    paddingLeft: 8,
    paddingVertical: 6,
    paddingRight: 8,
    marginBottom: 6,
    borderRadius: 2,
  },

  // Conseils numérotés (bloc blockquote + numéro en pastille)
  adviceRow: { flexDirection: "row", marginTop: 10, alignItems: "flex-start" },
  adviceBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    marginTop: 2,
  },
  adviceBadgeText: { color: colors.primary, fontFamily: "Helvetica-Bold", fontSize: 10 },
  adviceBody: { flex: 1 },

  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    fontSize: 8,
    color: colors.muted,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  // Phase 11 J4 — sections pédagogiques (résumé / présentation / théorie /
  // iconographie). Hiérarchie typographique récursive A24 :
  //   • h1 racine (16pt) : bandeau "Synthèse pédagogique" etc.
  //   • h2 (14pt) : titre racine d'une sous-section depth=0
  //   • h3 (12pt) : depth=1
  //   • h4 (11pt) : depth ≥ 2
  //   • paragraphe (10pt) : `contenu`
  //   • puces (10pt) : `points[]` avec caractère "•" (Helvetica supporte)
  //   • images : width 400pt fixe (hauteur auto, ratio natif préservé)
  //
  // Phase 11 J4-hotfix : @react-pdf/renderer ne supporte PAS `maxWidth`,
  // `maxHeight` ni `objectFit` sur `<Image>`. Les utiliser fait retomber
  // la lib sur l'inférence des dimensions natives qui peut produire des
  // valeurs flottantes invalides propagées dans le moteur Yoga (erreur
  // runtime "unsupported number: -8.559289250201232e+21" au moment du
  // pdf().toBlob()). Seules `width` et `height` (Number ou string `"N%"`)
  // sont supportées par la lib.
  pedagogySectionTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    marginBottom: 14,
    paddingBottom: 6,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  pedagogyTitleH2: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 6, color: colors.text },
  pedagogyTitleH3: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 5, color: colors.text },
  pedagogyTitleH4: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 4, color: colors.text },
  pedagogyParagraph: { fontSize: 10, marginBottom: 6, lineHeight: 1.5 },
  pedagogyBulletRow: { flexDirection: "row", marginBottom: 3 },
  pedagogyBulletChar: { width: 12, fontSize: 10 },
  pedagogyBulletText: { flex: 1, fontSize: 10, lineHeight: 1.5 },
  pedagogyImageCard: { marginBottom: 14 },
  pedagogyImage: { width: 400, marginBottom: 4 },
  pedagogyImageTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 4, marginBottom: 2, color: colors.text },
  pedagogyImageDesc: { fontSize: 9, color: colors.muted, lineHeight: 1.4 },
});

// ─────────── Helpers : accentuation des textes ───────────

const ACCENT_PDF: Record<AccentKind, { color: string; bold?: boolean; mono?: boolean; bg?: string }> = {
  problem: { color: colors.red, bold: true },
  action: { color: colors.primary, bold: true },
  benefit: { color: colors.emerald, bold: true },
  covered: { color: colors.emerald, bold: true },
  missing: { color: colors.red, bold: true },
  mnemonic: { color: colors.indigo, bold: true, mono: true, bg: colors.indigoSoft },
  percent: { color: colors.text, bold: true, mono: true },
  fraction: { color: colors.text, bold: true, mono: true },
};

// Retourne une liste de <Text> inline avec les styles d'accent appliqués. En
// @react-pdf/renderer, imbriquer <Text> dans <Text> conserve le flux inline —
// donc on peut construire le paragraphe accentué comme une succession de
// spans typés.
function renderAccentedText(input: string, keyPrefix = "a"): React.ReactNode {
  const tokens = tokenizeAccents(input);
  return tokens.map((t, i) => {
    if (t.accent === null) return <Text key={`${keyPrefix}-${i}`}>{t.text}</Text>;
    const style = ACCENT_PDF[t.accent];
    const fontFamily = style.bold
      ? (style.mono ? "Courier-Bold" : "Helvetica-Bold")
      : (style.mono ? "Courier" : undefined);
    return (
      <Text
        key={`${keyPrefix}-${i}`}
        style={{
          color: style.color,
          ...(fontFamily ? { fontFamily } : {}),
          ...(style.bg ? { backgroundColor: style.bg } : {}),
        }}
      >
        {t.text}
      </Text>
    );
  });
}

// ─────────── Parsing minimal du Markdown en blocs ───────────

interface TableBlock {
  kind: "table";
  headers: string[];
  rows: string[][];
}
interface HeadingBlock { kind: "heading"; level: number; text: string }
interface ParagraphBlock { kind: "paragraph"; text: string }
interface ListBlock { kind: "list"; ordered: boolean; items: string[] }
interface BlockquoteBlock { kind: "blockquote"; text: string }
interface HrBlock { kind: "hr" }

type Block = TableBlock | HeadingBlock | ParagraphBlock | ListBlock | BlockquoteBlock | HrBlock;

function stripInline(s: string): string {
  // Retire les emphase markdown `**x**`, `*x*`, `` `x` ``. On garde les emojis
  // et les accents. Les backticks → on garde juste le contenu.
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => stripInline(c));
}

function isSeparatorRow(line: string): boolean {
  return /^\s*\|?\s*:?-+:?(\s*\|\s*:?-+:?)+\s*\|?\s*$/.test(line);
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Ligne vide : skip
    if (trimmed === "") { i++; continue; }

    // HR
    if (/^\s*---+\s*$/.test(trimmed) || /^\s*___+\s*$/.test(trimmed) || /^\s*\*\*\*+\s*$/.test(trimmed)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    // Titre
    const h = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      blocks.push({ kind: "heading", level: h[1].length, text: stripInline(h[2]) });
      i++;
      continue;
    }

    // Tableau : ligne avec `|` puis séparateur.
    if (trimmed.startsWith("|") && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const headers = parseTableRow(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    // Blockquote (concaténé sur lignes consécutives)
    if (trimmed.startsWith(">")) {
      const acc: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        acc.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "blockquote", text: stripInline(acc.join(" ")) });
      continue;
    }

    // Liste (ul/ol)
    const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    const ulMatch = trimmed.match(/^[-•*]\s+(.+)$/);
    if (olMatch || ulMatch) {
      const ordered = !!olMatch;
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const m = ordered ? t.match(/^\d+\.\s+(.+)$/) : t.match(/^[-•*]\s+(.+)$/);
        if (!m) break;
        items.push(stripInline(m[1]));
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    // Paragraphe (ligne + lignes suivantes non vides et non spéciales)
    const acc: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6})\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith("|") &&
      !lines[i].trim().startsWith(">") &&
      !lines[i].trim().match(/^(\d+)\.\s+/) &&
      !lines[i].trim().match(/^[-•*]\s+/)
    ) {
      acc.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "paragraph", text: stripInline(acc.join(" ")) });
  }

  return blocks;
}

// ─────────── Rendu des blocs ───────────

function AxisRow({ name, weight, raw, score }: { name: string; weight: number; raw?: string; score: number }) {
  const tone = score >= 70 ? colors.emerald : score >= 50 ? colors.amber : colors.red;
  const safe = Math.max(0, Math.min(100, score));
  return (
    <View style={styles.axisRow} wrap={false}>
      <Text style={styles.axisName}>{name}</Text>
      <Text style={styles.axisWeight}>{Math.round(weight * 100)}%</Text>
      <Text style={styles.axisRaw}>{raw ?? "—"}</Text>
      <Text style={[styles.axisPercent, { color: tone }]}>{score}%</Text>
      <View style={styles.axisBarWrap}>
        <View style={[styles.axisBarFill, { width: `${safe}%`, backgroundColor: tone }]} />
      </View>
    </View>
  );
}

// Ordre des colonnes attendues pour un tableau d'items « | # | Item | Statut | Commentaire |ì.
function classifyHeaders(headers: string[]): {
  idCol: number; itemCol: number; statusCol: number; commentCol: number; otherCols: number[];
} {
  const idx = (predicate: (h: string) => boolean) =>
    headers.findIndex((h) => predicate(h.toLowerCase().trim()));
  const idCol = idx((h) => h === "#" || h === "id");
  const statusCol = idx((h) => h.startsWith("statut") || h.startsWith("résultat") || h.startsWith("resultat"));
  const itemCol = idx((h) => h.startsWith("item"));
  const commentCol = idx((h) => h.startsWith("commentaire") || h.startsWith("détails") || h.startsWith("details"));
  const used = new Set([idCol, statusCol, itemCol, commentCol]);
  const otherCols = headers.map((_, i) => i).filter((i) => !used.has(i));
  return { idCol, itemCol, statusCol, commentCol, otherCols };
}

// Les emojis ✅ ⚠️ ❌ ne sont pas rendus par Helvetica (tofu carré dans le PDF).
// On les remplace par un libellé ASCII court, tout en conservant la sémantique
// via la couleur de badge. La fraction éventuelle (« ⚠️ 3/5 ») est préservée.
function statusLabelForPdf(raw: string, icon: ReturnType<typeof classifyStatusCell>["icon"]): string {
  const fraction = raw.match(/\b\d+\s*\/\s*\d+\b/);
  const suffix = fraction ? ` ${fraction[0]}` : "";
  switch (icon) {
    case "ok": return "OK";
    case "partial": return `Partiel${suffix}`;
    case "missing": return "Manquant";
    case "na": return "N/A";
    case "unknown": return "?";
    default: return raw.trim() || "—";
  }
}

function StatusCell({ value }: { value: string }) {
  const { icon } = classifyStatusCell(value);
  const palette =
    icon === "ok" ? { bg: colors.emeraldSoft, fg: colors.emerald } :
    icon === "partial" ? { bg: colors.amberSoft, fg: colors.amber } :
    icon === "missing" ? { bg: colors.redSoft, fg: colors.red } :
    { bg: "#f1f5f9", fg: colors.muted };
  const label = statusLabelForPdf(value, icon);
  return (
    <View style={[styles.itemStatusCell, { backgroundColor: palette.bg }]}>
      <Text style={[styles.itemStatusText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

function ItemTable({ block }: { block: TableBlock }) {
  const { idCol, itemCol, statusCol, commentCol, otherCols } = classifyHeaders(block.headers);
  // Tableau reconnu comme « items » si on trouve au moins une colonne Statut.
  const isItemTable = statusCol >= 0;

  if (!isItemTable) {
    // Tableau générique : rendu en grille simple.
    return (
      <View style={styles.itemTable}>
        <View style={styles.itemHeaderRow}>
          {block.headers.map((h, i) => (
            <Text key={i} style={[styles.itemHeaderCell, { flex: 1, paddingRight: 4 }]}>
              {h}
            </Text>
          ))}
        </View>
        {block.rows.map((row, ri) => (
          <View key={ri} style={styles.itemRow} wrap={false}>
            {row.map((cell, ci) => (
              <Text key={ci} style={{ flex: 1, fontSize: 9.5, paddingRight: 4 }}>
                {renderAccentedText(cell, `r${ri}c${ci}`)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.itemTable}>
      <View style={styles.itemHeaderRow}>
        {idCol >= 0 && <Text style={[styles.itemHeaderCell, { width: 34 }]}>#</Text>}
        <Text style={[styles.itemHeaderCell, { flex: 2.5, paddingLeft: 4 }]}>
          {itemCol >= 0 ? block.headers[itemCol] : "Item"}
        </Text>
        <Text style={[styles.itemHeaderCell, { width: 60, textAlign: "center" }]}>
          {block.headers[statusCol]}
        </Text>
        <Text style={[styles.itemHeaderCell, { flex: 3, paddingLeft: 6 }]}>
          {commentCol >= 0 ? block.headers[commentCol] : "Commentaire"}
        </Text>
        {otherCols.map((c) => (
          <Text key={c} style={[styles.itemHeaderCell, { flex: 1, paddingLeft: 4 }]}>
            {block.headers[c]}
          </Text>
        ))}
      </View>
      {block.rows.map((row, ri) => (
        <View key={ri} style={styles.itemRow} wrap={false}>
          {idCol >= 0 && <Text style={styles.itemIdCell}>{row[idCol] ?? ""}</Text>}
          <Text style={styles.itemTextCell}>
            {renderAccentedText(itemCol >= 0 ? (row[itemCol] ?? "") : "", `r${ri}i`)}
          </Text>
          <StatusCell value={row[statusCol] ?? ""} />
          <Text style={styles.itemCommentCell}>
            {renderAccentedText(commentCol >= 0 ? (row[commentCol] ?? "") : "", `r${ri}c`)}
          </Text>
          {otherCols.map((c) => (
            <Text key={c} style={{ flex: 1, fontSize: 9, paddingLeft: 4 }}>
              {renderAccentedText(row[c] ?? "", `r${ri}o${c}`)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

// Détecte si une h2 correspond à une section narrative colorée spécialement.
function h2Banner(text: string): { bg: string; fg: string } {
  const t = text.toUpperCase();
  if (t.includes("POINTS FORTS")) return { bg: colors.emeraldSoft, fg: colors.emerald };
  if (t.includes("AXES") || t.includes("AMÉLIORATION") || t.includes("AMELIORATION")) {
    return { bg: colors.amberSoft, fg: colors.amber };
  }
  if (t.includes("CONSEIL")) return { bg: colors.primarySoft, fg: colors.primary };
  return { bg: colors.primarySoft, fg: colors.primary };
}

// Puces typographiques pour les titres dans le PDF. Helvetica ne contient pas de
// glyphes emoji (on évite donc 📊 📋 💡 ✅), mais ces formes géométriques
// appartiennent au bloc Geometric Shapes (U+25A0–U+25FF) pour lequel la fonte
// possède bien des glyphes.
function pdfHeadingBullet(raw: string): string {
  const h = raw.toUpperCase();
  if (h.includes("RAPPORT")) return "■ ";
  if (h.includes("DÉTAIL") || h.includes("DETAIL")) return "▸ ";
  if (h.includes("ANALYSE")) return "▸ ";
  if (h.includes("CONSEIL")) return "◆ ";
  if (h.includes("POINTS FORTS")) return "+ ";
  if (h.includes("AXES") || h.includes("AMÉLIORATION") || h.includes("AMELIORATION")) return "! ";
  return "▸ ";
}

function pdfHeadingBulletColor(raw: string): string {
  const h = raw.toUpperCase();
  if (h.includes("POINTS FORTS")) return colors.emerald;
  if (h.includes("AXES") || h.includes("AMÉLIORATION") || h.includes("AMELIORATION")) return colors.amber;
  if (h.includes("ANALYSE")) return colors.text;
  if (h.includes("CONSEIL")) return colors.primary;
  return colors.primary;
}

function RenderedBlocks({ blocks }: { blocks: Block[] }) {
  // Numérotation des conseils : on compte les h3 consécutifs après un h2
  // "CONSEILS PERSONNALISÉS" pour les afficher avec une pastille numérotée.
  let inAdvices = false;
  let adviceIndex = 0;

  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === "heading" && b.level === 2) {
      inAdvices = /CONSEIL/i.test(b.text);
      adviceIndex = 0;
      const palette = h2Banner(b.text);
      const bullet = pdfHeadingBullet(b.text);
      const bulletColor = pdfHeadingBulletColor(b.text);
      nodes.push(
        <View
          key={`b${i}`}
          style={[styles.sectionBanner, { backgroundColor: palette.bg }]}
          wrap={false}
        >
          <Text style={[styles.sectionBannerTitle, { color: palette.fg }]}>
            <Text style={{ color: bulletColor }}>{bullet}</Text>
            {b.text}
          </Text>
        </View>,
      );
      continue;
    }

    if (b.kind === "heading" && b.level === 3) {
      if (inAdvices) {
        adviceIndex++;
        nodes.push(
          <View key={`b${i}`} style={styles.adviceRow} wrap={false}>
            <View style={styles.adviceBadge}>
              <Text style={styles.adviceBadgeText}>{adviceIndex}</Text>
            </View>
            <View style={styles.adviceBody}>
              <Text style={styles.heading3}>{b.text}</Text>
            </View>
          </View>,
        );
      } else {
        nodes.push(
          <Text key={`b${i}`} style={styles.heading3}>
            {b.text}
          </Text>,
        );
      }
      continue;
    }

    if (b.kind === "heading") {
      nodes.push(
        <Text key={`b${i}`} style={[styles.heading3, { fontSize: 10 + (7 - b.level) * 0.5 }]}>
          {b.text}
        </Text>,
      );
      continue;
    }

    if (b.kind === "paragraph") {
      nodes.push(
        <Text key={`b${i}`} style={styles.paragraph}>
          {renderAccentedText(b.text, `p${i}`)}
        </Text>,
      );
      continue;
    }

    if (b.kind === "list") {
      nodes.push(
        <View key={`b${i}`} style={{ marginBottom: 6 }}>
          {b.items.map((it, j) => (
            <View key={j} style={styles.listItem}>
              <Text style={styles.listBullet}>{b.ordered ? `${j + 1}.` : "•"}</Text>
              <Text style={styles.listText}>{renderAccentedText(it, `l${i}-${j}`)}</Text>
            </View>
          ))}
        </View>,
      );
      continue;
    }

    if (b.kind === "blockquote") {
      nodes.push(
        <View key={`b${i}`} style={styles.blockquote}>
          <Text style={{ fontSize: 10 }}>{renderAccentedText(b.text, `q${i}`)}</Text>
        </View>,
      );
      continue;
    }

    if (b.kind === "table") {
      nodes.push(<ItemTable key={`b${i}`} block={b} />);
      continue;
    }

    if (b.kind === "hr") {
      nodes.push(
        <View
          key={`b${i}`}
          style={{ borderBottomWidth: 1, borderBottomColor: colors.border, marginVertical: 8 }}
        />,
      );
      continue;
    }
  }

  return <>{nodes}</>;
}

// ─────────── Phase 11 J4 — sections pédagogiques additives ───────────
//
// 3 sous-composants internes co-localisés, branchés conditionnellement
// après le rapport markdown détaillé. Quand `pedagogicalContent === null`
// ou que les 4 sous-blocs sont absents, AUCUNE section n'est rendue : le
// PDF reste byte-identique au rendu pré-Phase-11 (fallback gracieux A26).
//
// Caractères Unicode utilisés : "•" (U+2022) bien rendu par Helvetica.
// Les emojis (📚 🩺 📖 📷) sont intentionnellement ABSENTS du rendu PDF
// car Helvetica ne contient aucun glyphe emoji — ils tombent en tofu
// carré. On garde des libellés français explicites comme bandeau de
// section.

const PEDAGOGY_DEPTH_CAP = 4;

// Champs canoniques connus du schéma de sous-section. Tout autre champ
// (ex. `examensComplementaires`, `phrasesCles`, `rappelsTherapeutiques`)
// est rendu comme sous-bloc supplémentaire via le passthrough A24.
const SUBSECTION_KNOWN_KEYS = new Set([
  "titre",
  "contenu",
  "points",
  "subsections",
]);

// Champs canoniques d'un PedagogicalTree (ex. tree.sections, tree.titre).
// Mêmes règles passthrough : on absorbe les variantes top-level
// `theoriePratique` (8 variantes recensées).
const TREE_KNOWN_KEYS = new Set([
  "titre",
  "sections",
  "title",
  "body",
]);

// Convertit une clé camelCase ou snake_case en libellé humain. Utilisé
// pour rendre les champs passthrough comme titres de sous-blocs.
function humanizeKey(key: string): string {
  // camelCase → "camel Case", puis capitalise la première lettre.
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Style du titre selon la profondeur d'imbrication.
function pedagogyTitleStyleForDepth(depth: number) {
  if (depth <= 0) return styles.pedagogyTitleH2;
  if (depth === 1) return styles.pedagogyTitleH3;
  return styles.pedagogyTitleH4;
}

// Aplatit récursivement les sous-sections au-delà du cap (depth >= 4) en
// concaténant tous les textes accessibles (titre + contenu + points). Le
// résultat est rendu en un seul paragraphe pour respecter A24.
function flattenSubsection(sub: PedagogicalSubsection): string {
  const parts: string[] = [];
  if (sub.titre) parts.push(sub.titre);
  if (sub.contenu) parts.push(sub.contenu);
  if (Array.isArray(sub.points)) parts.push(sub.points.join(" • "));
  if (Array.isArray(sub.subsections)) {
    for (const child of sub.subsections) parts.push(flattenSubsection(child));
  }
  // Champs passthrough : on les sérialise en best-effort.
  for (const [key, value] of Object.entries(sub)) {
    if (SUBSECTION_KNOWN_KEYS.has(key)) continue;
    if (typeof value === "string") parts.push(`${humanizeKey(key)} : ${value}`);
    else if (Array.isArray(value)) {
      const strs = value.filter((v): v is string => typeof v === "string");
      if (strs.length > 0) parts.push(`${humanizeKey(key)} : ${strs.join(" • ")}`);
    }
  }
  return parts.filter(Boolean).join(" — ");
}

interface PedagogicalSubsectionRendererProps {
  subsection: PedagogicalSubsection;
  depth: number;
  keyPrefix: string;
}

// Rendu récursif d'une sous-section pédagogique. Indentation +12pt par
// niveau (paddingLeft = depth * 12). Cap récursion à
// `PEDAGOGY_DEPTH_CAP` ; au-delà, aplatissement A24.
function PedagogicalSubsectionRenderer({
  subsection,
  depth,
  keyPrefix,
}: PedagogicalSubsectionRendererProps) {
  // Cap profondeur : si on est au cap et qu'il existe encore des sous-
  // sections plus profondes, on rend le titre + un paragraphe aplati
  // contenant la totalité du sous-arbre.
  if (depth >= PEDAGOGY_DEPTH_CAP) {
    const flat = flattenSubsection(subsection);
    return (
      <View style={{ paddingLeft: depth * 12, marginBottom: 6 }} wrap={false}>
        {flat ? <Text style={styles.pedagogyParagraph}>{flat}</Text> : null}
      </View>
    );
  }

  const titleStyle = pedagogyTitleStyleForDepth(depth);

  // Champs passthrough rendus comme sous-blocs supplémentaires (A24).
  // Ex. `examensComplementaires`, `phrasesCles`. On les récupère dans
  // l'ordre d'insertion JSON, après les champs canoniques.
  const passthroughEntries: Array<[string, unknown]> = Object.entries(subsection).filter(
    ([k]) => !SUBSECTION_KNOWN_KEYS.has(k),
  );

  return (
    <View style={{ paddingLeft: depth * 12, marginBottom: 6 }}>
      {subsection.titre ? <Text style={titleStyle}>{subsection.titre}</Text> : null}
      {subsection.contenu ? (
        <Text style={styles.pedagogyParagraph}>{subsection.contenu}</Text>
      ) : null}
      {Array.isArray(subsection.points) && subsection.points.length > 0 ? (
        <View style={{ marginBottom: 6 }}>
          {subsection.points.map((p, i) => (
            <View key={`${keyPrefix}-pt${i}`} style={styles.pedagogyBulletRow} wrap={false}>
              <Text style={styles.pedagogyBulletChar}>{"•"}</Text>
              <Text style={styles.pedagogyBulletText}>{p}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {Array.isArray(subsection.subsections) && subsection.subsections.length > 0
        ? subsection.subsections.map((child, i) => (
            <PedagogicalSubsectionRenderer
              key={`${keyPrefix}-sub${i}`}
              subsection={child}
              depth={depth + 1}
              keyPrefix={`${keyPrefix}-sub${i}`}
            />
          ))
        : null}
      {passthroughEntries.map(([key, value], i) => {
        // Rendu d'une clé passthrough comme sous-bloc additionnel : titre h4
        // (humanizeKey) + valeur formatée selon son type.
        const subTitleStyle = pedagogyTitleStyleForDepth(Math.max(depth + 1, 2));
        if (typeof value === "string") {
          return (
            <View key={`${keyPrefix}-extra${i}`} style={{ marginTop: 4, marginBottom: 4 }}>
              <Text style={subTitleStyle}>{humanizeKey(key)}</Text>
              <Text style={styles.pedagogyParagraph}>{value}</Text>
            </View>
          );
        }
        if (Array.isArray(value)) {
          const stringPoints = value.filter((v): v is string => typeof v === "string");
          if (stringPoints.length > 0) {
            return (
              <View key={`${keyPrefix}-extra${i}`} style={{ marginTop: 4, marginBottom: 4 }}>
                <Text style={subTitleStyle}>{humanizeKey(key)}</Text>
                {stringPoints.map((p, j) => (
                  <View key={`${keyPrefix}-extra${i}-pt${j}`} style={styles.pedagogyBulletRow} wrap={false}>
                    <Text style={styles.pedagogyBulletChar}>{"•"}</Text>
                    <Text style={styles.pedagogyBulletText}>{p}</Text>
                  </View>
                ))}
              </View>
            );
          }
          // Tableau d'objets imbriqués : on les rend comme sous-sections.
          const subObjects = value.filter(
            (v): v is PedagogicalSubsection => typeof v === "object" && v !== null && !Array.isArray(v),
          );
          if (subObjects.length > 0) {
            return (
              <View key={`${keyPrefix}-extra${i}`} style={{ marginTop: 4 }}>
                <Text style={subTitleStyle}>{humanizeKey(key)}</Text>
                {subObjects.map((child, j) => (
                  <PedagogicalSubsectionRenderer
                    key={`${keyPrefix}-extra${i}-obj${j}`}
                    subsection={child}
                    depth={depth + 1}
                    keyPrefix={`${keyPrefix}-extra${i}-obj${j}`}
                  />
                ))}
              </View>
            );
          }
        }
        return null;
      })}
    </View>
  );
}

interface PedagogicalTreeSectionProps {
  tree: PedagogicalTree;
  sectionTitle: string;
  keyPrefix: string;
}

// Rendu d'une grande section pédagogique (résumé / présentation / théorie).
// Saut de page forcé en début (A25) via `<View break>`. Le titre racine
// vient soit de `tree.titre` soit du `sectionTitle` fallback.
function PedagogicalTreeSection({
  tree,
  sectionTitle,
  keyPrefix,
}: PedagogicalTreeSectionProps) {
  const rootTitle = tree.titre || tree.title || sectionTitle;
  // Champs racine passthrough (au-delà des canoniques TREE_KNOWN_KEYS).
  // Ex. `theoriePratique.examensComplementaires`, `rappelsTherapeutiques`.
  const passthroughEntries: Array<[string, unknown]> = Object.entries(tree).filter(
    ([k]) => !TREE_KNOWN_KEYS.has(k),
  );
  const sections = Array.isArray(tree.sections) ? tree.sections : [];
  const legacyBody = typeof tree.body === "string" ? tree.body : "";

  return (
    <View break>
      <Text style={styles.pedagogySectionTitle}>{rootTitle}</Text>
      {legacyBody ? <Text style={styles.pedagogyParagraph}>{legacyBody}</Text> : null}
      {sections.length > 0 ? (
        sections.map((sub, i) => (
          <PedagogicalSubsectionRenderer
            key={`${keyPrefix}-s${i}`}
            subsection={sub}
            depth={0}
            keyPrefix={`${keyPrefix}-s${i}`}
          />
        ))
      ) : null}
      {passthroughEntries.map(([key, value], i) => {
        // Variantes `theoriePratique` racine : rendues comme sous-blocs
        // après les sections canoniques. Si la valeur est un tableau
        // d'objets, on les rend comme sous-sections depth=0.
        if (typeof value === "string") {
          return (
            <View key={`${keyPrefix}-x${i}`} style={{ marginBottom: 8 }}>
              <Text style={styles.pedagogyTitleH2}>{humanizeKey(key)}</Text>
              <Text style={styles.pedagogyParagraph}>{value}</Text>
            </View>
          );
        }
        if (Array.isArray(value)) {
          const stringPoints = value.filter((v): v is string => typeof v === "string");
          if (stringPoints.length > 0) {
            return (
              <View key={`${keyPrefix}-x${i}`} style={{ marginBottom: 8 }}>
                <Text style={styles.pedagogyTitleH2}>{humanizeKey(key)}</Text>
                {stringPoints.map((p, j) => (
                  <View key={`${keyPrefix}-x${i}-pt${j}`} style={styles.pedagogyBulletRow} wrap={false}>
                    <Text style={styles.pedagogyBulletChar}>{"•"}</Text>
                    <Text style={styles.pedagogyBulletText}>{p}</Text>
                  </View>
                ))}
              </View>
            );
          }
          const subObjects = value.filter(
            (v): v is PedagogicalSubsection => typeof v === "object" && v !== null && !Array.isArray(v),
          );
          if (subObjects.length > 0) {
            return (
              <View key={`${keyPrefix}-x${i}`} style={{ marginBottom: 8 }}>
                <Text style={styles.pedagogyTitleH2}>{humanizeKey(key)}</Text>
                {subObjects.map((child, j) => (
                  <PedagogicalSubsectionRenderer
                    key={`${keyPrefix}-x${i}-obj${j}`}
                    subsection={child}
                    depth={0}
                    keyPrefix={`${keyPrefix}-x${i}-obj${j}`}
                  />
                ))}
              </View>
            );
          }
        }
        return null;
      })}
    </View>
  );
}

interface PedagogicalImagesBlockProps {
  images: PedagogicalImage[];
  keyPrefix: string;
}

// Rendu de l'iconographie pédagogique en bloc unique. Saut de page forcé
// (A25). Chaque image enveloppée dans `<View wrap={false}>` pour éviter
// la coupure milieu-page (A27). Format : image + titre h3 (gras 11pt) +
// description plain text 9pt.
function PedagogicalImagesBlock({ images, keyPrefix }: PedagogicalImagesBlockProps) {
  if (!Array.isArray(images) || images.length === 0) return null;
  return (
    <View break>
      <Text style={styles.pedagogySectionTitle}>Iconographie pédagogique</Text>
      {images.map((img, i) => {
        if (!img.data) return null;
        const title = img.title ?? "";
        const description = img.description ?? img.caption ?? "";
        return (
          <View key={`${keyPrefix}-img${i}`} style={styles.pedagogyImageCard} wrap={false}>
            <Image src={img.data} style={styles.pedagogyImage} />
            {title ? <Text style={styles.pedagogyImageTitle}>{title}</Text> : null}
            {description ? <Text style={styles.pedagogyImageDesc}>{description}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

// ─────────── Composant principal ───────────

export interface ReportPdfProps {
  scores: EvaluationScores;
  markdown: string;
  stationId: string;
  stationTitle: string;
  generatedAt: Date;
  // Phase 11 J4 — bloc pédagogique additif. Quand null/undefined, le PDF
  // reste strictement identique au rendu pré-Phase-11 (fallback gracieux
  // A26). Toujours en DERNIÈRE position du contrat de props pour ne
  // jamais déplacer une prop existante (schéma additif strict).
  pedagogicalContent?: PedagogicalContent | null;
}

export function ReportPdf({
  scores,
  markdown,
  stationId,
  stationTitle,
  generatedAt,
  pedagogicalContent,
}: ReportPdfProps) {
  // On supprime les redondances visuelles (score global, légende) côté PDF
  // également — la synthèse visuelle de la page 1 les remplace.
  const cleaned = stripRedundantSections(markdown);
  const blocks = parseBlocks(cleaned);

  const globalTone = scores.globalScore >= 70 ? colors.emerald : scores.globalScore >= 50 ? colors.amber : colors.red;
  const globalSoft = scores.globalScore >= 70 ? colors.emeraldSoft : scores.globalScore >= 50 ? colors.amberSoft : colors.redSoft;
  const pageFooterLabel = `${stationId}${stationTitle ? ` — ${stationTitle}` : ""} · ${generatedAt.toLocaleDateString("fr-FR")}`;

  return (
    <Document>
      {/* Page 1 : synthèse */}
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Rapport d'évaluation OSCE</Text>
          <Text style={styles.headerMeta}>
            Station {stationId}
            {stationTitle ? ` — ${stationTitle}` : ""} · Généré le {generatedAt.toLocaleString("fr-FR")}
          </Text>
        </View>

        <View style={[styles.globalBox, { borderColor: globalTone, backgroundColor: globalSoft }]}>
          <Text style={[styles.globalScore, { color: globalTone }]}>{scores.globalScore}%</Text>
          <View style={styles.globalMeta}>
            <Text style={styles.verdictLabel}>Verdict</Text>
            <Text style={[styles.verdictValue, { color: globalTone }]}>{scores.verdict}</Text>
            <Text style={{ fontSize: 9, color: colors.muted, marginTop: 4 }}>
              Moyenne pondérée des axes évalués.
            </Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Détail par axe</Text>
        <View style={styles.axisTable}>
          <View style={styles.axisHeaderRow}>
            <Text style={[styles.axisHeaderCell, { flex: 2.4 }]}>Section</Text>
            <Text style={[styles.axisHeaderCell, { flex: 0.8 }]}>Poids</Text>
            <Text style={[styles.axisHeaderCell, { flex: 0.8 }]}>Score</Text>
            <Text style={[styles.axisHeaderCell, { flex: 0.8 }]}>%</Text>
            <Text style={[styles.axisHeaderCell, { flex: 2 }]}>Progression</Text>
          </View>
          {scores.sections.map((s) => (
            <AxisRow key={s.key} name={s.name} weight={s.weight} raw={s.raw} score={s.score} />
          ))}
        </View>

        <Text style={styles.sectionLabel}>Rapport détaillé</Text>
        <RenderedBlocks blocks={blocks} />

        {/* Phase 11 J4 — sections pédagogiques additives (résumé / présentation /
            théorie / iconographie). Branchement strictement conditionnel : si
            `pedagogicalContent === null` ou si tous les sous-blocs sont absents,
            ces nodes ne s'évaluent à rien et le PDF reste byte-identique au
            rendu pré-Phase-11 (fallback A26). Saut de page forcé entre chaque
            grande section via `<View break>` (A25). */}
        {pedagogicalContent?.resume ? (
          <PedagogicalTreeSection
            tree={pedagogicalContent.resume}
            sectionTitle="Synthèse pédagogique"
            keyPrefix="ped-resume"
          />
        ) : null}
        {pedagogicalContent?.presentationPatient ? (
          <PedagogicalTreeSection
            tree={pedagogicalContent.presentationPatient}
            sectionTitle="Présentation systématisée"
            keyPrefix="ped-presentation"
          />
        ) : null}
        {pedagogicalContent?.theoriePratique ? (
          <PedagogicalTreeSection
            tree={pedagogicalContent.theoriePratique}
            sectionTitle="Théorie pratique"
            keyPrefix="ped-theorie"
          />
        ) : null}
        {pedagogicalContent?.images && pedagogicalContent.images.length > 0 ? (
          <PedagogicalImagesBlock
            images={pedagogicalContent.images}
            keyPrefix="ped-images"
          />
        ) : null}

        <PdfFooter label={pageFooterLabel} />
      </Page>
    </Document>
  );
}

function PdfFooter({ label }: { label: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{label}</Text>
      <Text
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}
