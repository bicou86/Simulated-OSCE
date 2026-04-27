// Catalogue statique des définitions de laboratoires Phase 3 J2.
//
// Source de vérité unique pour :
//  - les métadonnées d'un lab (label, paramètres, normes, unités, sources) ;
//  - les mots-clés qui permettent au classifier de reconnaître une demande
//    ("je demande une NFS" → clé `nfs`, "je prescris une CRP" → `crp`).
//
// ECOS invariant n°3 : zéro invention. La table est figée, typée par
// `as const satisfies`, et la station JSON ne fournit que les valeurs pour
// chaque paramètre. Le merge valeurs + définition est fait côté serveur
// (`server/services/labsService.ts`).
//
// Vit sous `shared/` pour être importable des deux côtés (serveur pour le
// lookup déterministe, client pour le classifier d'intention + rendu UI)
// via l'alias `@shared/*`.

export type LabFlag = "low" | "normal" | "high" | "critical";

export interface LabPediatricRange {
  // Bornes inclusives. `ageMax: 17` veut dire "jusqu'à 17 ans révolus",
  // `ageMin: 0` inclut nouveau-nés — attention aux sous-tranches d'âge en
  // néonatal où les normes changent radicalement. Préférer plusieurs entrées
  // plutôt qu'une large.
  ageMin: number;       // années, inclusif
  ageMax: number;       // années, inclusif
  min: number;
  max: number;
}

export interface LabParameterDefinition {
  key: string;          // identifiant stable, ex. "hb", "troponine_hs"
  label: string;        // libellé humain, ex. "Hémoglobine"
  unit: string;         // "g/dL", "mg/L", "mmol/L", "UI/L", "ng/L", ""
  // Normes adulte — utilisées par défaut si aucun pediatricRange ne matche
  // l'âge du patient. `min` / `max` inclusifs.
  normalRange: { min: number; max: number };
  // Pédiatrie : 0 ou plusieurs tranches d'âge. Si une tranche matche l'âge
  // du patient, elle remplace `normalRange` pour le flag + l'affichage.
  pediatricRange?: LabPediatricRange[];
  // Seuil critique optionnel : si la valeur dépasse en hausse ou chute en
  // dessous de ces bornes, on force le flag `critical`. Pour paramètres
  // sans seuil critique défini, on reste sur low/normal/high via normalRange.
  criticalLow?: number;
  criticalHigh?: number;
  // Référence clinique pour audit : édition + édition d'ouvrage ou URL.
  source?: string;
  // Note clinique courte affichée sous la ligne (optionnel). Usage parcimonieux.
  note?: string;
}

export interface LabDefinition {
  key: string;          // identifiant stable du lab, ex. "nfs", "troponine_hs"
  label: string;        // libellé humain pour le header de la bulle
  // Mots-clés normalisés (sans accents, minuscules) qui déclenchent le match
  // dans `matchLabKey()`. Ex. "nfs", "hemogramme" → `nfs`.
  keywords: readonly string[];
  parameters: readonly LabParameterDefinition[];
  // Commentaire éditorial court sur la grille (optionnel, audit pédagogique).
  editorialNote?: string;
}

// ─────────── Table des labs pilotes J2 ───────────
// 9 labs. Les valeurs de normes sont calibrées pour un adulte sain (18-70 ans)
// sauf indication explicite par `pediatricRange`. Toutes les normes sont
// révisables : la table est éditable, la modification passe par un commit +
// non-régression sur les fixtures qui consomment les flags impactés.

export const LAB_DEFINITIONS = {
  nfs: {
    key: "nfs",
    label: "Numération-formule sanguine (NFS)",
    keywords: [
      "nfs", "hemogramme", "formule sanguine", "fsc", "formule", "cbc",
      "numeration", "numeration formule",
    ],
    parameters: [
      {
        key: "hb",
        label: "Hémoglobine",
        unit: "g/dL",
        normalRange: { min: 12, max: 16 },
        pediatricRange: [
          { ageMin: 0, ageMax: 1, min: 10.5, max: 13.5 },
          { ageMin: 2, ageMax: 11, min: 11.5, max: 14.5 },
          { ageMin: 12, ageMax: 17, min: 12, max: 16 },
        ],
        criticalLow: 7,
        criticalHigh: 20,
        source: "Kratz et al., N Engl J Med 2004; AMBOSS 2024 (ref. hématologie).",
      },
      {
        key: "gb",
        label: "Leucocytes",
        unit: "G/L",
        normalRange: { min: 4, max: 10 },
        pediatricRange: [
          { ageMin: 0, ageMax: 1, min: 6, max: 17.5 },
          { ageMin: 2, ageMax: 5, min: 5, max: 15.5 },
          { ageMin: 6, ageMax: 11, min: 4.5, max: 13.5 },
          { ageMin: 12, ageMax: 17, min: 4, max: 11 },
        ],
        criticalLow: 1,
        criticalHigh: 30,
        source: "Nelson Textbook of Pediatrics 21st ed., appendix.",
      },
      {
        key: "plaquettes",
        label: "Plaquettes",
        unit: "G/L",
        normalRange: { min: 150, max: 400 },
        criticalLow: 20,
        criticalHigh: 1000,
        source: "AMBOSS 2024 — thrombopénies.",
      },
      {
        key: "neutrophiles",
        label: "Polynucléaires neutrophiles",
        unit: "G/L",
        normalRange: { min: 1.8, max: 7.5 },
        source: "Harrison's 21st ed., appendix A.",
      },
      {
        key: "lymphocytes",
        label: "Lymphocytes",
        unit: "G/L",
        normalRange: { min: 1, max: 4 },
        source: "Harrison's 21st ed., appendix A.",
      },
    ],
    editorialNote:
      "Normes adulte par défaut. Plages pédiatriques pour Hb et GB — à adapter par tranche d'âge.",
  },

  crp: {
    key: "crp",
    label: "Protéine C-réactive (CRP)",
    keywords: ["crp", "protéine c réactive", "proteine c reactive", "c reactive protein"],
    parameters: [
      {
        key: "crp",
        label: "CRP",
        unit: "mg/L",
        normalRange: { min: 0, max: 5 },
        criticalHigh: 200,
        source: "AMBOSS 2024 — marqueurs inflammatoires.",
        note: "Seuil d'inflammation significative > 10 mg/L. Pédiatrie : mêmes seuils.",
      },
    ],
  },

  ionogramme: {
    key: "ionogramme",
    label: "Ionogramme sanguin",
    keywords: ["ionogramme", "iono", "electrolytes", "iono sanguin", "iono sang"],
    parameters: [
      {
        key: "sodium",
        label: "Sodium",
        unit: "mmol/L",
        normalRange: { min: 135, max: 145 },
        criticalLow: 120,
        criticalHigh: 160,
        source: "Harrison's 21st ed.",
      },
      {
        key: "potassium",
        label: "Potassium",
        unit: "mmol/L",
        normalRange: { min: 3.5, max: 5 },
        criticalLow: 2.5,
        criticalHigh: 6.5,
        source: "Harrison's 21st ed.",
      },
      {
        key: "chlore",
        label: "Chlore",
        unit: "mmol/L",
        normalRange: { min: 98, max: 107 },
        source: "Harrison's 21st ed.",
      },
      {
        key: "creatinine",
        label: "Créatinine",
        unit: "µmol/L",
        normalRange: { min: 45, max: 110 },
        criticalHigh: 500,
        source: "KDIGO 2024 guidelines.",
      },
      {
        key: "uree",
        label: "Urée",
        unit: "mmol/L",
        normalRange: { min: 2.5, max: 7.5 },
        source: "Harrison's 21st ed.",
      },
    ],
  },

  gaz_du_sang: {
    key: "gaz_du_sang",
    label: "Gaz du sang artériel",
    keywords: ["gaz du sang", "gds", "gazometrie", "gazometrie arterielle", "gaz arteriels"],
    parameters: [
      {
        key: "ph",
        label: "pH",
        unit: "",
        normalRange: { min: 7.35, max: 7.45 },
        criticalLow: 7.2,
        criticalHigh: 7.55,
        source: "Harrison's 21st ed., troubles acidobasiques.",
      },
      {
        key: "pco2",
        label: "PaCO2",
        unit: "mmHg",
        normalRange: { min: 35, max: 45 },
        criticalLow: 25,
        criticalHigh: 60,
        source: "Harrison's 21st ed.",
      },
      {
        key: "po2",
        label: "PaO2",
        unit: "mmHg",
        normalRange: { min: 80, max: 100 },
        criticalLow: 55,
        source: "Harrison's 21st ed.",
      },
      {
        key: "hco3",
        label: "Bicarbonates",
        unit: "mmol/L",
        normalRange: { min: 22, max: 26 },
        source: "Harrison's 21st ed.",
      },
      {
        key: "saturation",
        label: "Saturation artérielle",
        unit: "%",
        normalRange: { min: 95, max: 100 },
        criticalLow: 88,
        source: "Harrison's 21st ed.",
      },
    ],
  },

  bilan_hepatique: {
    key: "bilan_hepatique",
    label: "Bilan hépatique",
    keywords: [
      "bilan hepatique", "bilan hepatique complet", "tests hepatiques",
      "transaminases", "asat alat", "ast alt",
    ],
    parameters: [
      {
        key: "asat",
        label: "ASAT",
        unit: "UI/L",
        normalRange: { min: 10, max: 40 },
        criticalHigh: 1000,
        source: "AMBOSS 2024 — cytolyse hépatique.",
      },
      {
        key: "alat",
        label: "ALAT",
        unit: "UI/L",
        normalRange: { min: 10, max: 40 },
        criticalHigh: 1000,
        source: "AMBOSS 2024 — cytolyse hépatique.",
      },
      {
        key: "pal",
        label: "Phosphatases alcalines",
        unit: "UI/L",
        normalRange: { min: 40, max: 130 },
        source: "Harrison's 21st ed.",
      },
      {
        key: "ggt",
        label: "Gamma-GT",
        unit: "UI/L",
        normalRange: { min: 10, max: 50 },
        source: "Harrison's 21st ed.",
      },
      {
        key: "bilirubine_totale",
        label: "Bilirubine totale",
        unit: "µmol/L",
        normalRange: { min: 3, max: 21 },
        criticalHigh: 340,
        source: "AMBOSS 2024 — cholestase.",
      },
      {
        key: "bilirubine_conjuguee",
        label: "Bilirubine conjuguée",
        unit: "µmol/L",
        normalRange: { min: 0, max: 5 },
        source: "AMBOSS 2024 — cholestase.",
      },
    ],
  },

  bilan_renal: {
    key: "bilan_renal",
    label: "Bilan rénal",
    keywords: ["bilan renal", "fonction renale", "creatinine uree", "dfg"],
    parameters: [
      {
        key: "creatinine",
        label: "Créatinine",
        unit: "µmol/L",
        normalRange: { min: 45, max: 110 },
        criticalHigh: 500,
        source: "KDIGO 2024 guidelines.",
      },
      {
        key: "uree",
        label: "Urée",
        unit: "mmol/L",
        normalRange: { min: 2.5, max: 7.5 },
        source: "Harrison's 21st ed.",
      },
      {
        key: "dfg",
        label: "DFG estimé (CKD-EPI)",
        unit: "mL/min/1.73m²",
        normalRange: { min: 90, max: 130 },
        criticalLow: 15,
        source: "KDIGO 2024 — classification de l'IRC.",
      },
    ],
  },

  troponine_hs: {
    key: "troponine_hs",
    label: "Troponine hs",
    keywords: [
      "troponine", "troponine hs", "troponines", "troponine haute sensibilite",
    ],
    parameters: [
      {
        key: "troponine_hs",
        label: "Troponine hs",
        unit: "ng/L",
        // Seuil de décision pour un adulte — pragmatique : 14 ng/L (99e
        // percentile de la distribution saine, seuil mixte non sexe-spécifique
        // retenu pour simplicité des stations pilotes).
        normalRange: { min: 0, max: 14 },
        criticalHigh: 100,
        source: "ESC 2023 Guidelines on NSTE-ACS ; cutoff hs-cTnT sexe-neutre 14 ng/L.",
        note:
          "Seuils sexe-spécifiques (H : 22, F : 14 en hs-cTnI) non modélisés en J2 — " +
          "valeur retenue est un proxy pédagogique. Cinétique critique : la 2e mesure H+3h est le vrai test diagnostique.",
      },
    ],
  },

  bhcg: {
    key: "bhcg",
    label: "βHCG",
    keywords: ["bhcg", "beta hcg", "hcg", "beta-hcg", "test de grossesse"],
    parameters: [
      {
        key: "bhcg_qual",
        label: "βHCG qualitatif",
        unit: "",
        // On modélise via un range pour réutiliser la plomberie de flag :
        // 0 = négatif (normal pour femme non enceinte), 1 = positif.
        normalRange: { min: 0, max: 0 },
        source: "AMBOSS 2024 — suivi de grossesse.",
        note:
          "Résultat qualitatif codé 0 (négatif) / 1 (positif). Flag high = test positif.",
      },
    ],
  },

  lipase: {
    key: "lipase",
    label: "Lipase pancréatique",
    keywords: ["lipase", "lipase pancreatique"],
    parameters: [
      {
        key: "lipase",
        label: "Lipase",
        unit: "UI/L",
        normalRange: { min: 13, max: 60 },
        criticalHigh: 180,
        source: "AMBOSS 2024 — pancréatites aiguës.",
        note: "Élévation > 3× la limite supérieure → critère d'Atlanta (pancréatite aiguë).",
      },
    ],
  },
} as const satisfies Record<string, LabDefinition>;

export type LabKey = keyof typeof LAB_DEFINITIONS;

// ─────────── Runtime guard ───────────
// Dès le premier import, on valide que chaque entrée a au moins 1 paramètre,
// que les normes sont cohérentes (min ≤ max), et que les seuils critiques
// sont en dehors du range normal. Un lab mal configuré jette à l'import
// plutôt qu'au run — évite qu'un mauvais flag soit affiché silencieusement
// en simulation.

(function assertLabDefinitionsIntegrity(): void {
  // `as const satisfies` narrows chaque entrée à un littéral précis — utile
  // pour le typing consommateur, mais ça casse l'itération générique ci-dessous
  // (ex. `p.criticalLow` n'existe que sur certains paramètres). On élargit
  // explicitement au type interface pour la validation.
  const table = LAB_DEFINITIONS as Record<string, LabDefinition>;
  for (const [key, def] of Object.entries(table)) {
    if (def.key !== key) {
      throw new Error(`[lab-definitions] clé table "${key}" ≠ def.key "${def.key}"`);
    }
    if (def.parameters.length === 0) {
      throw new Error(`[lab-definitions] "${key}" : 0 paramètre défini`);
    }
    for (const p of def.parameters) {
      if (p.normalRange.min > p.normalRange.max) {
        throw new Error(
          `[lab-definitions] "${key}.${p.key}" : normalRange.min (${p.normalRange.min}) > max (${p.normalRange.max})`,
        );
      }
      if (p.criticalLow !== undefined && p.criticalLow > p.normalRange.min) {
        throw new Error(
          `[lab-definitions] "${key}.${p.key}" : criticalLow (${p.criticalLow}) doit être ≤ normalRange.min (${p.normalRange.min})`,
        );
      }
      if (p.criticalHigh !== undefined && p.criticalHigh < p.normalRange.max) {
        throw new Error(
          `[lab-definitions] "${key}.${p.key}" : criticalHigh (${p.criticalHigh}) doit être ≥ normalRange.max (${p.normalRange.max})`,
        );
      }
      if (p.pediatricRange) {
        for (const pr of p.pediatricRange) {
          if (pr.ageMin > pr.ageMax) {
            throw new Error(
              `[lab-definitions] "${key}.${p.key}" : pediatricRange ageMin (${pr.ageMin}) > ageMax (${pr.ageMax})`,
            );
          }
          if (pr.min > pr.max) {
            throw new Error(
              `[lab-definitions] "${key}.${p.key}" : pediatricRange min (${pr.min}) > max (${pr.max})`,
            );
          }
        }
      }
    }
  }
})();

// ─────────── Accesseurs ───────────

export function getLabDefinition(key: string): LabDefinition | undefined {
  return (LAB_DEFINITIONS as Record<string, LabDefinition>)[key];
}

export const LAB_KEYS: readonly string[] = Object.keys(LAB_DEFINITIONS);

// ─────────── Flag computation ───────────
// Pure helper réutilisable côté serveur (flag par défaut d'un paramètre) et
// côté client (re-compute en tests UI). Respecte la hiérarchie :
//   critical > high/low > normal
// `age` permet de sélectionner une pediatricRange si présente et applicable.

export function pickRangeForAge(
  param: LabParameterDefinition,
  ageYears: number | null | undefined,
): { min: number; max: number; source: "adult" | "pediatric" } {
  if (ageYears == null || !param.pediatricRange) {
    return { ...param.normalRange, source: "adult" };
  }
  const match = param.pediatricRange.find(
    (r) => ageYears >= r.ageMin && ageYears <= r.ageMax,
  );
  if (match) {
    return { min: match.min, max: match.max, source: "pediatric" };
  }
  return { ...param.normalRange, source: "adult" };
}

export function computeFlag(
  param: LabParameterDefinition,
  value: number,
  ageYears: number | null | undefined,
): LabFlag {
  if (param.criticalLow !== undefined && value <= param.criticalLow) return "critical";
  if (param.criticalHigh !== undefined && value >= param.criticalHigh) return "critical";
  const range = pickRangeForAge(param, ageYears);
  if (value < range.min) return "low";
  if (value > range.max) return "high";
  return "normal";
}
