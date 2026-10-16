// Crop growth-stage profiles (biology targets). Port of hydro/profiles.py.
import maize from '../data/maize.json';
import envelope from '../data/dataset_envelope.json';

export type Range = [number, number];

export interface Stage {
  name: string;
  start_day: number;
  end_day: number;
  air_temp_c: Range;
  humidity_pct: Range;
  ph: Range;
  ec_ms_cm: Range;
  light_hours: number;
  spectrum: string;
  biology: string;
}

export interface CropProfile {
  crop: string;
  display_name: string;
  lights_on_hour: number;
  stages: Stage[];
}

// Parameters that have a [lo, hi] target in every stage.
export const RANGED = ['air_temp_c', 'humidity_pct', 'ph', 'ec_ms_cm'] as const;
export type RangedKey = (typeof RANGED)[number];

const PROFILES: Record<string, CropProfile> = { maize: maize as unknown as CropProfile };

export function load(crop: string): CropProfile {
  const p = PROFILES[crop];
  if (!p) throw new Error(`no profile for crop ${crop}`);
  return p;
}

export function datasetEnvelope(): Record<string, Range> {
  return (envelope as unknown as { envelope: Record<string, Range> }).envelope;
}

export function dayOfGrow(plantedAt: number, ts: number): number {
  return Math.max(0, (ts - plantedAt) / 86400);
}

export function stageFor(crop: string, day: number): Stage {
  const stages = load(crop).stages;
  for (const s of stages) if (day <= s.end_day + 0.999) return s;
  return stages[stages.length - 1];
}

export function stageIndex(crop: string, name: string): number {
  return load(crop).stages.findIndex((s) => s.name === name);
}
