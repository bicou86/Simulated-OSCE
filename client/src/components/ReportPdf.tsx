// Document PDF du rapport d'évaluation OSCE.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { EvaluationScores } from "@/lib/api";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10.5, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: { borderBottomWidth: 2, borderBottomColor: "#4f46e5", paddingBottom: 12, marginBottom: 20 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  subtitle: { fontSize: 11, color: "#525252" },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 13, fontFamily: "Helvetica-Bold", marginBottom: 8, color: "#4f46e5",
  },
  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6,
  },
  scoreLabel: { fontSize: 11, flex: 1 },
  scoreValue: { fontSize: 11, fontFamily: "Helvetica-Bold", width: 60, textAlign: "right" },
  bar: {
    height: 6, backgroundColor: "#e5e7eb", borderRadius: 3, flex: 2, marginHorizontal: 10,
  },
  barFill: { height: 6, backgroundColor: "#4f46e5", borderRadius: 3 },
  globalBox: {
    borderWidth: 1, borderColor: "#4f46e5", backgroundColor: "#eef2ff",
    padding: 12, borderRadius: 6, marginBottom: 16,
  },
  globalScore: { fontSize: 28, fontFamily: "Helvetica-Bold", color: "#4f46e5" },
  verdict: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 4 },
  narrativeTitle: {
    fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 6, color: "#4f46e5",
  },
  narrativeText: { fontSize: 10, lineHeight: 1.45, marginBottom: 8 },
  footer: {
    marginTop: 18, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: "#e5e7eb",
    fontSize: 9, color: "#737373", textAlign: "center",
  },
});

interface ReportPdfProps {
  scores: EvaluationScores;
  markdown: string;
  stationId: string;
  stationTitle: string;
  generatedAt: Date;
}

function ScoreRow({ label, value, raw }: { label: string; value: number; raw?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.scoreLabel}>{label}</Text>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, value))}%` }]} />
      </View>
      <Text style={styles.scoreValue}>{raw ? `${raw} (${value}%)` : `${value}%`}</Text>
    </View>
  );
}

// Simplification markdown → lignes de texte lisibles en PDF :
// - retire emojis, code fences, bullets, gras/italique
// - conserve les titres et les lignes avec leur contenu
function markdownToText(md: string): string[] {
  return md
    // code fences → ignoré (les tableaux box-drawing sont transformés plus bas)
    .replace(/```[\s\S]*?```/g, (block) => {
      // on conserve les tableaux box-drawing en retirant les lignes de cadre.
      return block
        .replace(/^```[^\n]*\n/, "")
        .replace(/\n```$/, "")
        .split("\n")
        .filter((l) => !/^[│┌├└─┤┬┴┼]+/.test(l.trim()))
        .join("\n");
    })
    .replace(/[\uD83C-\uD83F][\uDC00-\uDFFF]|[☀-➿]|[️‍]/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-•]\s+/gm, "• ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""));
}

export function ReportPdf({ scores, markdown, stationId, stationTitle, generatedAt }: ReportPdfProps) {
  const lines = markdownToText(markdown);
  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header}>
          <Text style={styles.title}>Rapport d'évaluation OSCE</Text>
          <Text style={styles.subtitle}>
            {stationId}{stationTitle ? ` — ${stationTitle}` : ""}
          </Text>
          <Text style={styles.subtitle}>Généré le {generatedAt.toLocaleString("fr-FR")}</Text>
        </View>

        <View style={styles.globalBox}>
          <Text style={{ fontSize: 10, color: "#525252" }}>Score global</Text>
          <Text style={styles.globalScore}>{scores.globalScore}%</Text>
          <Text style={styles.verdict}>Verdict : {scores.verdict}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Détail par section</Text>
          {scores.sections.map((s) => (
            <ScoreRow
              key={s.key}
              label={`${s.name} (poids ${(s.weight * 100).toFixed(0)}%)`}
              value={s.score}
              raw={s.raw}
            />
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.narrativeTitle}>Rapport détaillé</Text>
          {lines.map((line, idx) => (
            <Text
              key={idx}
              style={[
                styles.narrativeText,
                /^#+\s/.test(line) ? { fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 4 } : {},
              ]}
            >
              {line.replace(/^#+\s*/, "")}
            </Text>
          ))}
        </View>

        <Text style={styles.footer}>
          Rapport généré par OSCE Sim — évaluation produite par Claude Sonnet 4.5.
        </Text>
      </Page>
    </Document>
  );
}
