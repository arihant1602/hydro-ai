// Plant photos: shrink, analyse on the phone (colour rules + leaf disease model), keep the photo + overlay,
// raise/clear photo alerts. Bundled sample leaves go through the same analysis without being stored.
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import jpeg from 'jpeg-js';

import { classify, leafFeatures, withModel } from '../engine/leafModel';
import { dayOfGrow, stageFor } from '../engine/profiles';
import { analysePixels, MIN_GREEN_PCT, visionAlerts, WORK_SIDE, type Analysis } from '../engine/vision';
import type { LeafSample } from '../data/leaf_samples';
import { first, getSettings, query, run } from './db';
import { syncAlertGroup } from './hydro';

const DIR = new Directory(Paths.document, 'photos');

export interface Photo {
  id: number;
  ts: number;
  file: string;
  overlay: string | null;
  day: number;
  stage: string;
  analysis: Analysis | null;
}

// A frame this dark isn't a dim photo, it's the camera handing back nothing (lens covered, camera still
// starting, or an emulator camera that can't take stills). Refuse it instead of logging "no plant in view".
const BLACK_FRAME = 0.03;
export class BlackFrameError extends Error {
  constructor() {
    super('The camera returned a black frame. Try again, or pick a photo from the gallery.');
  }
}

/** Shrink to the working size, analyse (colour rules + leaf disease model), save photo + overlay into `dir`. */
async function analyseInto(dir: Directory, uri: string, width: number, height: number, name: string) {
  if (!dir.exists) dir.create({ intermediates: true });
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize(width >= height ? { width: WORK_SIDE, height: null } : { width: null, height: WORK_SIDE });
  const small = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
  const photo = new File(dir, `${name}.jpg`);
  await new File(small.uri).copy(photo);

  let analysis: Analysis;
  let overlayUri: string | null = null;
  try {
    const img = jpeg.decode(await photo.bytes(), { useTArray: true, formatAsRGBA: true });
    const res = analysePixels(img.data, img.width, img.height);
    if ((res.analysis.brightness ?? 1) < BLACK_FRAME) {
      photo.delete();
      throw new BlackFrameError();
    }
    const x = leafFeatures(res.seg);
    analysis = withModel(res.analysis, x ? classify(x) : null);
    overlayUri = await saveOverlay(dir, res.overlay, res.width, res.height, `${name}-overlay.jpg`);
  } catch (e) {
    if (e instanceof BlackFrameError) throw e;
    analysis = { verdict: 'analysis failed', issues: [['error', String(e)]], version: 1 };
  }
  return { file: photo.uri, overlay: overlayUri, analysis };
}

/** Analyse a photo of the plant (camera or gallery, any size), keep it in the history and raise/clear alerts. */
export async function addPhoto(uri: string, width: number, height: number): Promise<Photo> {
  const now = Date.now() / 1000;
  const { file, overlay, analysis } = await analyseInto(DIR, uri, width, height, `${Math.round(now * 1000)}`);
  const s = await getSettings();
  const day = dayOfGrow(s.planted_at, now);
  const stage = stageFor(s.crop, day).name;
  const r = await run(
    'INSERT INTO photos(ts, file, overlay, day, stage, analysis) VALUES(?,?,?,?,?,?)',
    now, file, overlay, Math.round(day * 100) / 100, stage, JSON.stringify(analysis));
  await syncAlertGroup('vision_', visionAlerts(analysis), now);
  return { id: r.lastInsertRowId, ts: now, file, overlay, day, stage, analysis };
}

const SAMPLE_DIR = new Directory(Paths.cache, 'leaf-samples');

/** Analyse a bundled sample leaf exactly like a photo, but keep it out of the plant's history and alerts. */
export async function analyseSample(sample: LeafSample): Promise<Photo> {
  if (SAMPLE_DIR.exists) SAMPLE_DIR.delete(); // one sample result at a time
  SAMPLE_DIR.create({ intermediates: true });
  const src = new File(SAMPLE_DIR, 'source.jpg');
  src.write(Uint8Array.from(atob(sample.jpeg), (ch) => ch.charCodeAt(0)));
  const now = Date.now() / 1000;
  const { file, overlay, analysis } = await analyseInto(SAMPLE_DIR, src.uri, sample.width, sample.height, `${Math.round(now * 1000)}`);
  return { id: -1, ts: now, file, overlay, day: 0, stage: '', analysis };
}

/** RGBA -> JPEG file. jpeg-js's encoder needs Node's Buffer, so write a BMP and let the native side re-encode. */
async function saveOverlay(dir: Directory, rgba: Uint8Array, w: number, h: number, name: string): Promise<string> {
  const bmp = new File(Paths.cache, `${name}.bmp`);
  bmp.write(toBmp(rgba, w, h));
  const ctx = ImageManipulator.manipulate(bmp.uri);
  const out = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  const dest = new File(dir, name);
  await new File(out.uri).copy(dest);
  bmp.delete();
  return dest.uri;
}

function toBmp(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const row = (w * 3 + 3) & ~3; // rows are padded to 4 bytes
  const size = 54 + row * h;
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x42; // "BM"
  buf[1] = 0x4d;
  dv.setUint32(2, size, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true); // positive height = bottom-up rows
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(34, row * h, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      buf[o++] = rgba[i + 2];
      buf[o++] = rgba[i + 1];
      buf[o++] = rgba[i];
    }
  }
  return buf;
}

type Row = Omit<Photo, 'analysis'> & { analysis: string | null };
const parse = (r: Row): Photo => ({ ...r, analysis: r.analysis ? JSON.parse(r.analysis) : null });

export async function listPhotos(limit = 24): Promise<Photo[]> {
  return (await query<Row>('SELECT * FROM photos ORDER BY ts DESC LIMIT ?', limit)).map(parse);
}

/** Latest analysis from the last 24 h, for the advisor. */
export async function recentAnalysis(): Promise<Analysis | null> {
  const r = await first<Row>('SELECT * FROM photos WHERE analysis IS NOT NULL ORDER BY ts DESC LIMIT 1');
  return r && Date.now() / 1000 - r.ts < 86400 ? parse(r).analysis : null;
}

/** Canopy cover over time, from photos that contain a plant. */
export async function growthSeries() {
  return (await query<Row>('SELECT * FROM photos WHERE analysis IS NOT NULL ORDER BY ts'))
    .map(parse)
    .filter((p) => (p.analysis?.green_pct ?? 0) >= MIN_GREEN_PCT)
    .map((p) => ({ ts: p.ts, day: p.day, canopy_pct: p.analysis!.canopy_pct!, dgci: p.analysis!.dgci ?? null }));
}

export async function deletePhoto(p: Photo) {
  for (const uri of [p.file, p.overlay]) if (uri) new File(uri).delete();
  await run('DELETE FROM photos WHERE id=?', p.id);
}
