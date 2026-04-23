// Service d'indexation des stations OSCE.
// - Au démarrage, parse les 14 fichiers Patient_*.json pour construire un catalogue mémoire.
// - Aucun accès direct aux données cliniques à partir d'ici : seuls les IDs, titres, sources
//   et settings sont exposés. Les contenus (scripts patient, grilles) restent dans leurs
//   services dédiés (patientService, evaluatorService).

import { promises as fs } from "fs";
import path from "path";
import { extractAge, extractSex } from "../lib/patientSex";
import { resolveInterlocutor } from "../lib/patientInterlocutor";
import { inferStationType, type StationType } from "./stationTypeInference";

export type StationSource = "AMBOSS" | "German" | "RESCOS" | "USMLE" | "USMLE_Triage";

export interface StationMeta {
  id: string;          // "RESCOS-1"
  fullId: string;      // "RESCOS-1 - Adénopathie sus-claviculaire - ECC Lymphatique"
  title: string;       // "Adénopathie sus-claviculaire - ECC Lymphatique"
  source: StationSource;
  setting: string;
  stationType: StationType;        // inféré au démarrage par 6 règles déterministes
  stationTypeMatchedRule: string;  // id de la règle qui a gagné (audit/debug)
  // Localisation physique des données (usage interne aux services patient/évaluateur).
  patientFile: string;   // ex: "Patient_RESCOS_1.json"
  evaluatorFile: string; // ex: "Examinateur_RESCOS_1.json"
  indexInFile: number;   // index dans le tableau stations[]
}

const PATIENT_DIR = path.resolve(import.meta.dirname, "..", "data", "patient");
const EVALUATOR_DIR = path.resolve(import.meta.dirname, "..", "data", "evaluator");

// Map indexée par shortId → meta (source de vérité en mémoire).
const catalog = new Map<string, StationMeta>();

function extractShortId(fullId: string): string {
  // "RESCOS-1 - Adénopathie sus-claviculaire" → "RESCOS-1"
  const idx = fullId.indexOf(" - ");
  return idx === -1 ? fullId : fullId.slice(0, idx);
}

function extractTitle(fullId: string): string {
  const idx = fullId.indexOf(" - ");
  return idx === -1 ? "" : fullId.slice(idx + 3).trim();
}

// Charge un fichier Patient_*.json et en extrait les métadonnées nécessaires au catalogue.
async function ingestPatientFile(filename: string): Promise<void> {
  const filePath = path.join(PATIENT_DIR, filename);
  const content = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(content) as {
    source: StationSource;
    stations: Array<{
      id: string;
      setting?: string;
      patient_description?: string;
      age?: string | number;
      specialite?: string;
    }>;
  };

  const evaluatorFilename = filename.replace(/^Patient_/, "Examinateur_");
  const isDev = process.env.NODE_ENV !== "production";

  parsed.stations.forEach((station, idx) => {
    const shortId = extractShortId(station.id);
    if (catalog.has(shortId)) {
      // Doublon : on garde la première occurrence mais on log.
      // eslint-disable-next-line no-console
      console.warn(`[stationsService] doublon d'ID ignoré : ${shortId} dans ${filename}`);
      return;
    }

    // Inférence station_type — déterministe, 6 règles dans l'ordre. Log dev
    // uniquement, pour audit de la répartition sur les 284 stations (invariant
    // ECOS n°3 : aucun LLM dans le typage structurel).
    const patientDescription = station.patient_description ?? "";
    const sex = extractSex(patientDescription);
    const age = extractAge(station.age, patientDescription);
    const interlocutor = resolveInterlocutor({ patientDescription, age, sex });
    const inference = inferStationType({
      id: shortId,
      fullId: station.id,
      title: extractTitle(station.id),
      source: parsed.source,
      setting: station.setting ?? "",
      patientDescription,
      age,
      interlocutorType: interlocutor.type,
      specialite: typeof station.specialite === "string" ? station.specialite : undefined,
    });

    if (isDev) {
      // eslint-disable-next-line no-console
      console.info(JSON.stringify({
        event: "station_type_inference",
        stationId: shortId,
        type: inference.type,
        matchedRule: inference.matchedRule,
      }));
    }

    catalog.set(shortId, {
      id: shortId,
      fullId: station.id,
      title: extractTitle(station.id),
      source: parsed.source,
      setting: station.setting ?? "",
      stationType: inference.type,
      stationTypeMatchedRule: inference.matchedRule,
      patientFile: filename,
      evaluatorFile: evaluatorFilename,
      indexInFile: idx,
    });
  });
}

// Agrégation `count(*) group by stationType` pour audit humain de la
// répartition sur les 284 stations. Utile pour valider que les règles
// d'inférence ne sont ni trop larges ni trop étroites.
export function countByStationType(): Record<StationType, number> {
  const out: Record<StationType, number> = {
    teleconsultation: 0,
    pediatrie_accompagnant: 0,
    bbn: 0,
    psy: 0,
    triage: 0,
    anamnese_examen: 0,
  };
  Array.from(catalog.values()).forEach((meta) => {
    const key = meta.stationType;
    out[key] = out[key] + 1;
  });
  return out;
}

let initPromise: Promise<void> | null = null;

export async function initCatalog(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const files = await fs.readdir(PATIENT_DIR);
    const patientFiles = files.filter((f) => f.startsWith("Patient_") && f.endsWith(".json"));
    await Promise.all(patientFiles.map((f) => ingestPatientFile(f)));
    // eslint-disable-next-line no-console
    console.log(`[stationsService] ${catalog.size} stations indexées depuis ${patientFiles.length} fichiers.`);
  })();
  return initPromise;
}

export function listStations(): StationMeta[] {
  return Array.from(catalog.values()).sort((a, b) => a.id.localeCompare(b.id, "fr", { numeric: true }));
}

export function getStationMeta(shortId: string): StationMeta | undefined {
  return catalog.get(shortId);
}

// Helpers d'accès aux chemins des JSON — seuls patientService et evaluatorService
// doivent les utiliser.
export function patientFilePath(filename: string): string {
  return path.join(PATIENT_DIR, filename);
}
export function evaluatorFilePath(filename: string): string {
  return path.join(EVALUATOR_DIR, filename);
}
