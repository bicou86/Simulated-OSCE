// Document PDF du rapport d'évaluation OSCE.
// Rendu via @react-pdf/renderer côté navigateur (pas d'appel serveur).

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { EvaluationReport } from "@/lib/api";

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 11,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: "#4f46e5",
    paddingBottom: 12,
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 11,
    color: "#525252",
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
    color: "#4f46e5",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  scoreLabel: {
    fontSize: 11,
    flex: 1,
  },
  scoreValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    width: 40,
    textAlign: "right",
  },
  bar: {
    height: 6,
    backgroundColor: "#e5e7eb",
    borderRadius: 3,
    flex: 2,
    marginHorizontal: 10,
    overflow: "hidden",
  },
  barFill: {
    height: 6,
    backgroundColor: "#4f46e5",
    borderRadius: 3,
  },
  globalBox: {
    borderWidth: 1,
    borderColor: "#4f46e5",
    backgroundColor: "#eef2ff",
    padding: 12,
    borderRadius: 6,
    marginBottom: 16,
  },
  globalScore: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    color: "#4f46e5",
  },
  verdict: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
  },
  listItem: {
    flexDirection: "row",
    marginBottom: 4,
  },
  bullet: {
    width: 10,
    fontSize: 11,
  },
  listText: {
    flex: 1,
    fontSize: 10.5,
    lineHeight: 1.4,
  },
  footer: {
    marginTop: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    fontSize: 9,
    color: "#737373",
    textAlign: "center",
  },
});

interface ReportPdfProps {
  report: EvaluationReport;
  stationTitle: string;
  stationSpecialty?: string;
  generatedAt: Date;
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.scoreLabel}>{label}</Text>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${value}%` }]} />
      </View>
      <Text style={styles.scoreValue}>{value}%</Text>
    </View>
  );
}

function BulletList({ items, color }: { items: string[]; color: string }) {
  if (items.length === 0) {
    return <Text style={{ fontStyle: "italic", color: "#737373", fontSize: 10 }}>Aucun élément relevé.</Text>;
  }
  return (
    <View>
      {items.map((item, idx) => (
        <View key={idx} style={styles.listItem}>
          <Text style={[styles.bullet, { color }]}>•</Text>
          <Text style={styles.listText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export function ReportPdf({ report, stationTitle, stationSpecialty, generatedAt }: ReportPdfProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Rapport d'évaluation OSCE</Text>
          <Text style={styles.subtitle}>
            {stationTitle}
            {stationSpecialty ? ` — ${stationSpecialty}` : ""}
          </Text>
          <Text style={styles.subtitle}>Généré le {generatedAt.toLocaleString("fr-FR")}</Text>
        </View>

        <View style={styles.globalBox}>
          <Text style={{ fontSize: 10, color: "#525252" }}>Score global</Text>
          <Text style={styles.globalScore}>{report.globalScore}%</Text>
          <Text style={styles.verdict}>Verdict : {report.verdict}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Détail par axe</Text>
          <ScoreRow label="Anamnèse (30%)" value={report.anamnese} />
          <ScoreRow label="Examen clinique (25%)" value={report.examen} />
          <ScoreRow label="Communication (20%)" value={report.communication} />
          <ScoreRow label="Diagnostic & Prise en charge (25%)" value={report.diagnostic} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Points forts</Text>
          <BulletList items={report.strengths} color="#059669" />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Omissions critiques</Text>
          <BulletList items={report.criticalOmissions} color="#dc2626" />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Priorités d'amélioration</Text>
          <BulletList items={report.priorities} color="#d97706" />
        </View>

        <Text style={styles.footer}>
          Rapport généré par OSCE Sim — évaluation produite par Claude Sonnet 4.5.
        </Text>
      </Page>
    </Document>
  );
}
