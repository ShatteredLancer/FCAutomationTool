import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageKind } from './probe.mjs';
import { inspectEaRatingDifferential } from './ea-rating-differential.mjs';
import { inspectEaChemistryDifferential } from './ea-chemistry-differential.mjs';
import { inspectEaRequirementDifferential } from './ea-requirement-differential.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function inspectPuzzlePlan(page, setId, challengeId) {
  if (pageKind(page.url()) !== 'web-app') return { status: 'blocked', reason: 'WEB_APP_REQUIRED', liveExecutionEnabled: false };
  if (![setId, challengeId].every(id => Number.isSafeInteger(id) && id > 0 && id < 1e9)) throw new Error('FC27_PUZZLE_ID_INVALID');
  const result = await build({ absWorkingDir: root, stdin: { contents: `
    export { inspectFc27VerifiedPuzzlePlan } from './src/adapters/ea/fc27-puzzle-verify.js';
    export { probeFc27TeamFactsRuntime } from './src/adapters/ea/fc27-team-facts-probe.js';
    export { mountFc27PuzzleResultPanel } from './src/adapters/browser/fc27-puzzle-result-panel.js';`, resolveDir: root,
    sourcefile: 'puzzle-exact-inspection.js' },
    bundle: true, write: false, metafile: true, format: 'iife', globalName: 'FC27PuzzleRead', target: 'chrome120' });
  const allowed = new Set(['puzzle-exact-inspection.js', 'src/adapters/ea/fc27-puzzle-read.js', 'src/adapters/ea/fc27-local-read.js',
    'src/adapters/ea/fc27-fsu-read.js', 'src/adapters/ea/fc27-fsu-diagnostics.js', 'src/adapters/ea/fc27-traditional-read.js',
    'src/adapters/ea/fc27-challenge-catalog.js', 'src/adapters/ea/fc27-sbc-read.js', 'src/domain/player-rarity.js',
    'src/fc27/prelaunch-contract.js', 'src/fc27/traditional-preview.js', 'src/fc27/sbc-requirements.js', 'src/fc27/puzzle-preview.js', 'src/fc27/puzzle-evaluator.js',
    'src/adapters/ea/fc27-club-read.js', 'src/adapters/ea/fc27-puzzle-verify.js', 'src/fc27/puzzle-fill-plan.js',
    'src/adapters/ea/fc27-team-facts-probe.js', 'src/fc27/puzzle-material-policy.js',
    'src/adapters/browser/fc27-puzzle-result-panel.js']);
  if (Object.keys(result.metafile.inputs).some(name => !allowed.has(name.replaceAll('\\', '/')))) throw new Error('Unreviewed Puzzle inspection dependency');
  const payload = await page.evaluate(`(async () => { ${result.outputFiles[0].text}
    globalThis.document.getElementById('fcat-puzzle-readonly')?.remove();
    let transient = null;
    const report = await FC27PuzzleRead.inspectFc27VerifiedPuzzlePlan(globalThis, { setId: ${setId}, challengeId: ${challengeId} }, value => {
      transient = value;
    });
    if (report.status !== 'preview' || report.plan?.exactValidation?.status !== 'verified') transient = null;
    report.eaTeamFactsProbe = await FC27PuzzleRead.probeFc27TeamFactsRuntime(globalThis);
    try { FC27PuzzleRead.mountFc27PuzzleResultPanel({ document: globalThis.document, report }); }
    catch { /* Display failure cannot change the verification result. */ }
    return { report, transient }; })()`);
  const report = payload && Object.hasOwn(payload, 'report') ? payload.report : payload;
  if (!report || typeof report !== 'object' || Array.isArray(report)
      || Object.hasOwn(report, 'transient')) {
    return { status: 'blocked', reason: 'FC27_PUZZLE_REPORT_UNAVAILABLE',
      executable: false, liveExecutionEnabled: false };
  }
  // One command compares the same exact-checked selection against all reviewed
  // algorithms. The temporary player projection never enters the saved report.
  const eaRatingDifferential = await inspectEaRatingDifferential(report);
  const eaChemistryDifferential = eaRatingDifferential.status === 'verified'
    ? await inspectEaChemistryDifferential(report, payload?.transient) : {
      status: 'unverified', reason: 'FC27_EA_CHEMISTRY_RATING_PREREQUISITE', chemistryVerified: false,
      executable: false, liveExecutionEnabled: false, reusableForExecution: false,
    };
  const facts = { ...report, eaRatingDifferential, eaChemistryDifferential };
  const eaRequirementDifferential = await inspectEaRequirementDifferential(facts, payload?.transient);
  const verified = eaRatingDifferential.status === 'verified' && eaChemistryDifferential.status === 'verified'
    && eaRequirementDifferential.status === 'verified' && eaRequirementDifferential.eaOverall === true;
  const aggregated = { ...facts, eaRequirementDifferential,
    pending: [...new Set([...(report.pending ?? []), 'PUZZLE_FILL_TRANSACTION',
      ...(verified ? [] : ['EA_TEAM_FACTS_DIFFERENTIAL'])])].filter(reason => !verified || reason !== 'EA_TEAM_FACTS_DIFFERENTIAL') };
  // Refresh only our aggregate display. Never retain a page-side plan or write handle.
  try {
    await page.evaluate(`(() => { ${result.outputFiles[0].text}
      FC27PuzzleRead.mountFc27PuzzleResultPanel({ document: globalThis.document,
        report: ${JSON.stringify(aggregated).replaceAll('<', '\\u003c')} }); })()`);
  } catch { /* Display failure does not change verification evidence. */ }
  return aggregated;
}
