// End-to-end check of what the app shows for a leaf photo, using the app's own code: decode -> 512 px ->
// colour rules -> features -> random forest -> combined verdict (leafModel.withModel). Scores the held-out test
// images from tools/train_leaf_model.py (data/raw/plantvillage_maize/split.json).
//
//   npx tsx scripts/eval_leaf_app.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { classify, CONFIDENT, diseaseOf, withModel } from '../src/engine/leafModel';
import { analyseFile } from './leaf_features';

const ROOT = join(__dirname, '..', '..', 'data', 'raw', 'plantvillage_maize');
const FOLDER: Record<string, string> = {
  healthy: 'healthy',
  Common_rust: 'common_rust',
  Northern_Leaf_Blight: 'northern_leaf_blight',
  Cercospora_leaf_spot_Gray_leaf_spot: 'gray_leaf_spot',
};

const test: string[] = JSON.parse(readFileSync(join(ROOT, 'split.json'), 'utf8')).test;
let appOk = 0;
let rulesOk = 0;
let named = 0;
let namedOk = 0;
const verdicts: Record<string, Record<string, number>> = {};
for (const file of test) {
  const truth = FOLDER[basename(dirname(file))];
  const sick = truth !== 'healthy';
  const { analysis, features } = analyseFile(file);
  const final = withModel(analysis, features ? classify(features) : null);
  (verdicts[truth] ??= {})[final.verdict] = (verdicts[truth][final.verdict] ?? 0) + 1;
  appOk += Number(sick ? final.verdict === 'needs attention' : final.verdict === 'healthy');
  rulesOk += Number(sick ? analysis.verdict === 'needs attention' : analysis.verdict === 'healthy');
  const tag = final.issues.find(([k]) => k.startsWith('disease_'));
  if (sick && tag) {
    named++;
    namedOk += Number(tag[0] === `disease_${truth}`);
  }
  // A confident disease call must name the disease, except on bad lighting, where the verdict stays 'uncertain (lighting)'.
  if (final.disease && !tag && analysis.verdict !== 'uncertain (lighting)' && diseaseOf(final.disease).pSick >= CONFIDENT)
    throw new Error(`confident call without a disease name: ${file}`);
}
const n = test.length;
console.log(`test images: ${n}, threshold ${CONFIDENT}`);
console.log(`app verdict healthy-vs-diseased correct: ${appOk}/${n} = ${(appOk / n).toFixed(4)}`);
console.log(`colour rules alone:                    ${rulesOk}/${n} = ${(rulesOk / n).toFixed(4)}`);
console.log(`diseased leaves given a disease name:  ${named}, name correct ${namedOk} = ${(namedOk / Math.max(named, 1)).toFixed(4)}`);
console.log('final verdicts by true class:', JSON.stringify(verdicts, null, 1));

// Append these numbers to the training report (replacing an earlier run's section).
const REPORT = join(__dirname, '..', '..', 'report', 'leaf_model_report.md');
const MARK = '## End to end (the app\'s own code)';
const report = readFileSync(REPORT, 'utf8').split(MARK)[0].trimEnd();
const rows = Object.entries(verdicts).map(([k, v]) => `| ${k} | ${Object.entries(v).map(([a, b]) => `${a} ${b}`).join(', ')} |`);
writeFileSync(
  REPORT,
  `${report}

${MARK}

scripts/eval_leaf_app.ts runs every test image through the app's pipeline (decode, 512 px, colour rules,
features, forest, combined verdict) and scores what the user sees.

- Healthy vs diseased correct: **${appOk}/${n} (${((100 * appOk) / n).toFixed(1)}%)**; the colour rules alone: ${rulesOk}/${n} (${((100 * rulesOk) / n).toFixed(1)}%).
- Diseased leaves the app names a disease for: ${named}; the name is right for ${namedOk} (${((100 * namedOk) / Math.max(named, 1)).toFixed(1)}%).

| True class | App verdicts |
|---|---|
${rows.join('\n')}
`,
);
console.log('report updated:', REPORT);
