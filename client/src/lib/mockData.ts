import { createContext, useContext, useState, ReactNode } from "react";

interface Station {
  id: string;
  title: string;
  source: 'AMBOSS' | 'RESCOS' | 'USMLE' | 'German' | 'Triage';
  specialty: string;
  scenario: string;
  openingLine: string;
  context: string;
  vitals: {
    hr: string;
    bp: string;
    rr: string;
    temp: string;
    spo2: string;
  };
  duration: number;
}

export const MOCK_STATIONS: Station[] = [
  {
    id: "rescos-001",
    title: "Douleurs Thoraciques Aiguës",
    source: "RESCOS",
    specialty: "Cardiologie",
    scenario: "Un patient de 65 ans se présente aux urgences pour des douleurs thoraciques constrictives irradiant dans le bras gauche.",
    openingLine: "Docteur, j'ai l'impression qu'un éléphant est assis sur ma poitrine...",
    context: "Le patient a des antécédents d'hypertension et de diabète de type 2. Fumeur (1 paquet/jour).",
    vitals: {
      hr: "110 bpm",
      bp: "160/95 mmHg",
      rr: "22/min",
      temp: "37.1 °C",
      spo2: "94% à l'air ambiant"
    },
    duration: 13
  },
  {
    id: "amboss-042",
    title: "Céphalées en Coup de Tonnerre",
    source: "AMBOSS",
    specialty: "Neurologie",
    scenario: "Patiente de 45 ans se plaignant de la pire migraine de sa vie apparue soudainement.",
    openingLine: "Ma tête va exploser, c'est venu d'un coup !",
    context: "Aucun antécédent notable. Ne prend pas de contraception orale.",
    vitals: {
      hr: "95 bpm",
      bp: "140/85 mmHg",
      rr: "18/min",
      temp: "37.5 °C",
      spo2: "98% à l'air ambiant"
    },
    duration: 13
  },
  {
    id: "usmle-012",
    title: "Dyspnée et Toux Productive",
    source: "USMLE",
    specialty: "Pneumologie",
    scenario: "Patient de 55 ans consultant pour une difficulté à respirer croissante et une toux avec crachats jaunâtres.",
    openingLine: "Je n'arrive plus à reprendre mon souffle quand je monte les escaliers.",
    context: "BPCO connue. Oublie souvent ses inhalateurs.",
    vitals: {
      hr: "105 bpm",
      bp: "135/80 mmHg",
      rr: "28/min",
      temp: "38.2 °C",
      spo2: "89% à l'air ambiant"
    },
    duration: 13
  },
  {
    id: "triage-005",
    title: "Douleur Abdominale Fosse Iliaque Droite",
    source: "Triage",
    specialty: "Chirurgie",
    scenario: "Jeune homme de 20 ans avec douleur abdominale basse à droite, nausées et perte d'appétit depuis 24h.",
    openingLine: "J'ai mal au ventre, surtout en bas à droite. Je ne peux pas me tenir droit.",
    context: "Aucun antécédent. Douleur initialement péri-ombilicale.",
    vitals: {
      hr: "90 bpm",
      bp: "120/75 mmHg",
      rr: "16/min",
      temp: "38.0 °C",
      spo2: "99% à l'air ambiant"
    },
    duration: 13
  }
];

export type { Station };