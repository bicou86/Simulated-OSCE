// Document PDF du rapport d'évaluation OSCE.
// Rendu structuré : page 1 = synthèse visuelle (score global + 4 axes avec
// barres), pages suivantes = détail (tableaux d'items, sections narratives)
// avec palette de couleurs pédagogiques cohérente avec l'affichage web.

import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { EvaluationScores } from "@/lib/api";
import { stripRedundantSections, classifyStatusCell } from "@/lib/reportFormatting";
import { type AccentKind, tokenizeAccents } from "@/lib/reportAccents";

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

const styles = StyleSheet.create({
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

// ─────────── Composant principal ───────────

interface ReportPdfProps {
  scores: EvaluationScores;
  markdown: string;
  stationId: string;
  stationTitle: string;
  generatedAt: Date;
}

export function ReportPdf({ scores, markdown, stationId, stationTitle, generatedAt }: ReportPdfProps) {
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
