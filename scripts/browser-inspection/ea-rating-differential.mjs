import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Script, createContext } from 'node:vm';

const path = 'UTSquadEntity.prototype._calculateRating';
const hash = '398beb4841b2f7e08b46c8c556ee4be2e6d3ed991ec8adcbe0dbb13e467adc7e';
const sourceFile = new URL('../../artifacts/fc27-browser/ea-compiled_2.js', import.meta.url);
const stop = reason => ({ status: 'unverified', reason, scope: 'isolated-ea-rating-algorithm',
  liveExecutionEnabled: false, executable: false, chemistryVerified: false, requirementsVerified: false });

// Execute only one reviewed EA function body, in an isolated local VM with
// copied ratings. Never execute a downloaded bundle or invoke a page function.
export async function inspectEaRatingDifferential(report, { readSource = () => readFile(sourceFile, 'utf8') } = {}) {
  const plan = report?.plan;
  const ratings = plan?.ratings;
  const mode = report?.configuration?.floatCalculationEnabled;
  if (report?.status !== 'preview' || report.reason !== 'READ_ONLY_PLAN' || report.executable !== false
      || report.liveExecutionEnabled !== false || plan?.exactValidation?.status !== 'verified'
      || plan.selectedCount !== 11 || plan.exactValidation.presentCount !== 11
      || typeof mode !== 'boolean' || !Array.isArray(ratings) || ratings.length !== 11
      || Array.from(ratings).some(n => !Number.isSafeInteger(n) || n < 1 || n > 74)
      || !Array.isArray(plan.slots) || plan.slots.length !== 11 || new Set(plan.slots).size !== 11
      || plan.slots.some(n => !Number.isSafeInteger(n) || n < 0 || n > 10)
      || report.layout?.slotCount !== 11 || report.layout.requiredPlayerCount !== 11
      || report.layout.simpleBrickIndices?.length !== 0 || report.layout.customBrickIndices?.length !== 0
      || !Number.isSafeInteger(plan.teamFacts?.teamRating) || plan.teamFacts.teamRating < 0 || plan.teamFacts.teamRating > 99) {
    return stop('FC27_EA_RATING_INPUT_UNVERIFIED');
  }
  const targets = report.eaTeamFactsProbe?.targets?.filter(t => t.path === 'UTSquadEntity.prototype');
  const observed = targets?.length === 1 && targets[0].present === true && targets[0].truncated === false
    ? targets[0].methods.filter(m => m.name === '_calculateRating') : [];
  if (observed.length !== 1 || observed[0].kind !== 'function' || observed[0].arity !== 0 || observed[0].sha256 !== hash) {
    return stop('FC27_EA_RATING_METHOD_UNREVIEWED');
  }
  try {
    const bundle = await readSource();
    if (typeof bundle !== 'string' || bundle.length > 15000000) return stop('FC27_EA_RATING_SOURCE_UNAVAILABLE');
    const marker = `${path}=`;
    const start = bundle.indexOf(marker);
    const end = bundle.indexOf(',UTSquadEntity.prototype.updateChemistry=', start);
    if (start < 0 || end < 0 || bundle.indexOf(marker, start + 1) >= 0 || end - start > 4096) {
      return stop('FC27_EA_RATING_SOURCE_UNAVAILABLE');
    }
    const source = bundle.slice(start + marker.length, end).replace(/\r\n/g, '\n');
    if (createHash('sha256').update(source).digest('hex') !== hash) return stop('FC27_EA_RATING_SOURCE_UNREVIEWED');
    const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
    const actual = new Script(`'use strict';
      const ratings = ${JSON.stringify(ratings)};
      const UTSquadEntity = Object.freeze({ FIELD_PLAYERS: 11 });
      const UTServerSettingsRepository = { KEY: { SQUAD_RATING_FLOAT_CALCULATION_ENABLED: 'rating' } };
      const services = { Configuration: { checkFeatureEnabled(key) {
        if (key !== 'rating') throw new Error('Unknown flag'); return ${mode};
      } } };
      const receiver = { isSBC: () => true,
        getFieldPlayers: () => ratings.map(rating => ({ item: { rating, isValid: () => true } })) };
      (${source}).call(receiver);
      receiver._rating;
    `).runInContext(context, { timeout: 100 });
    if (!Number.isSafeInteger(actual) || actual < 0 || actual > 99) return stop('FC27_EA_RATING_RESULT_UNVERIFIED');
    return { ...stop(actual === plan.teamFacts.teamRating ? 'FC27_EA_RATING_DIFFERENTIAL_MATCH' : 'FC27_EA_RATING_DIFFERENTIAL_MISMATCH'),
      status: actual === plan.teamFacts.teamRating ? 'verified' : 'mismatch',
      local: plan.teamFacts.teamRating, ea: actual, ratingMode: mode ? 'float' : 'integer',
      selectedCount: 11, methodSha256: hash, reusableForExecution: false };
  } catch { return stop('FC27_EA_RATING_SOURCE_UNAVAILABLE'); }
}
