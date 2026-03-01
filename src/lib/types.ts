export interface ShapePaths {
  land: string[];
  island: string[];
  clickable: string[];
}

export type Geometry = Record<string, ShapePaths>;

export interface LandInfo {
  fillColorNumber: number;
  countryCode: string;
  showCircle?: boolean;
  cx?: number;
  cy?: number;
  lw?: number;
}

export type LandsInfo = Record<string, LandInfo>;

export interface ContinentalRegion {
  landIdentifiers: string[];
  displayBounds: string;
  navigationNeighbors: Record<string, string>;
}

export interface ProvincialRegion {
  landIdentifiers: string[];
  displayBounds: string;
  enabled: boolean;
}

export interface LandStructure {
  capital: string | null;
  otherCities: string[];
}

export interface Structure {
  continentalRegions: Record<string, ContinentalRegion>;
  provincialRegions: Record<string, ProvincialRegion>;
  lands: Record<string, LandStructure>;
}

export interface CityCoord {
  x: number;
  y: number;
}

export type Cities = Record<string, CityCoord>;

export type QuizMode = 'countries' | 'capitals' | 'states';
export type QuizPhase = 'asking' | 'feedback-correct' | 'feedback-wrong' | 'done';

export interface QuizState {
  region: string;
  mode: QuizMode;
  queue: string[];
  currentIndex: number;
  score: number;
  phase: QuizPhase;
  targetId: string;
  clickedId: string;
}
