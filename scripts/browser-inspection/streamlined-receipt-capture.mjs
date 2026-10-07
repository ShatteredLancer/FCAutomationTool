import { writeFile } from 'node:fs/promises';

const marker = Symbol.for('fcat.streamlined.receipt-capture');
const id = value => Number.isSafeInteger(value) && value > 0;
const count = value => Array.isArray(value) && value.length <= 1000 ? value.length : null;
const shape = value => value === undefined ? 'absent' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

// Public challenge identifiers and counts only. Never retain award contents,
// item identities, objectives, request bodies, headers or authentication data.
export function projectNativeStreamlinedResponse(response, { setId, challengeId, httpStatus }) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  if (response.challengeId !== challengeId || response.setId !== setId) return null;
  return { setId, challengeId, httpStatus,
    submittedScore: Number.isSafeInteger(response.submittedScore) && response.submittedScore >= 0 ? response.submittedScore : null,
    challengeAwardCount: count(response.grantedChallengeAwards), setAwardCount: count(response.grantedSetAwards),
    challengeAwardShape: shape(response.grantedChallengeAwards), setAwardShape: shape(response.grantedSetAwards),
    squadsPresent: response.squads !== undefined, squadCount: count(response.squads),
    objectiveUpdatesPresent: response.dynamicObjectivesUpdates != null,
    rewardConfirmed: false };
}

// Passive Playwright observer, scoped to one explicit native submit endpoint.
// It never initiates a request, clicks a button or changes any EA model.
export function armStreamlinedReceiptCapture(page, { setId, challengeId, destination, now = () => Date.now(),
  save = (file, data) => writeFile(file, data) } = {}) {
  if (!id(setId) || !id(challengeId) || typeof page.on !== 'function') throw Error('STREAMLINED_CAPTURE_TARGET_REQUIRED');
  const previous = page[marker];
  if (previous?.setId === setId && previous.challengeId === challengeId) return previous.report();
  previous?.dispose();
  const observations = [], started = now(); let tail = Promise.resolve(), disposed = false;
  const report = () => ({ status: 'armed', setId, challengeId, passive: true, captured: observations.length,
    expiresAt: started + 30 * 60 * 1000, eaMutationsPerformed: false });
  const listener = response => {
    tail = tail.then(async () => {
      if (disposed || observations.length >= 4 || now() - started > 30 * 60 * 1000) return;
      const request = response.request(), url = new URL(response.url());
      if (request.method() !== 'POST' || url.protocol !== 'https:' || !/(^|\.)ea\.com$/i.test(url.hostname)
          || url.pathname !== `/ut/game/fc27/sbs/challenge/${challengeId}/item/submit` || url.search) return;
      const body = await response.body();
      if (body.length > 262144) return;
      const projected = projectNativeStreamlinedResponse(JSON.parse(body.toString('utf8')),
        { setId, challengeId, httpStatus: response.status() });
      if (!projected) return;
      observations.push({ at: now(), ...projected });
      await save(destination, `${JSON.stringify({ schema: 1, source: 'passive-native-contribution-response',
        agentPerformedMutation: false, observations }, null, 2)}\n`);
    }).catch(() => { /* Observational failures cannot affect an EA transaction. */ });
  };
  const dispose = () => { disposed = true; page.off('response', listener); };
  page[marker] = { setId, challengeId, report, dispose, settled: () => tail };
  page.on('response', listener);
  return report();
}
