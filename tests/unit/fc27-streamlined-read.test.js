import { expect, it } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { locateFc27StreamlinedPage, readFc27StreamlinedInputs, inspectFc27Streamlined, createFc27StreamlinedMatcher } from '../../src/adapters/ea/fc27-streamlined-read.js';
import { challenge as fixtureChallenge } from '../helpers/streamlined.js';
import { inspectStreamlined } from '../../scripts/browser-inspection/streamlined-inspection.mjs';
import { runInNewContext } from 'node:vm';

function runtime() {
  const f = executionRuntime(), { root } = f;
  root.document = {};
  const anchor = { isConnected: true, ownerDocument: root.document };
  const challenge = { id: 61, setId: 31, status: 'IN_PROGRESS', name: 'Synthetic points', isOneClickChallenge: () => true,
    scoreRequirement: 2500, submittedScore: 0, eligibilityOperation: 'AND',
    eligibilityRequirements: [{ count: -1, scope: 0, kvPairs: { _collection: { 40: [45], 41: [1] } } }] };
  const set = { id: 31, repeats: 1, repeatabilityMode: 'REFRESH' };
  class Split { constructor() { this.workAreaController = { viewModel: { getChallenge: () => challenge, getSet: () => set,
    getSelectionLimit: () => 30 }, getView: () => ({ getRootElement: () => anchor }) }; } }
  root.UTOneClickSBCWorkAreaSplitViewController = Split;
  const controller = new Split();
  root.getAppMain = () => ({ getRootViewController: () => ({ currentController: controller }) });
  root.UTEvolutionEligibilityVO = class { isValid = true; meetsRequirements = item => item._rating >= 45; };
  for (const item of Object.values(root.repositories.Item.club.items._collection)) item.sbsScore = 20;
  return { ...f, challenge, set, controller, anchor };
}
it('reads exact native score, scope and source without a network request or Puzzle ceiling', () => {
  const f = runtime();
  f.root.info.set.goldenrange = 90;
  expect(locateFc27StreamlinedPage(f.root)?.challengeId).toBe(61);
  const input = readFc27StreamlinedInputs(f.root);
  expect(input.challenge).toMatchObject({ targetScore: 2500, selectionLimit: 30, repeats: 1 });
  expect(input.policy.maxRating).toBe(90);
  expect(input.inventory[0]).toMatchObject({ points: 20, scoreVerified: true, price: null, loans: -1, special: false });
  expect(input.eligibility.matches(input.inventory[0]).status).toBe('eligible');
  expect(input.resolveDisplayItem(input.inventory[0])).toBe(f.root.repositories.Item.club.items._collection[1]);
  expect(input.resolveDisplayItem({ ...input.inventory[0], definitionId: 999 })).toBeNull();
  input.assertCurrent(); expect(f.calls).toEqual([]);
  f.challenge.submittedScore = 20;
  expect(input.assertCurrent).toThrow('CONTEXT_CHANGED');
});
it('rejects unrelated screens, invalid rules, missing point accessors and account changes', () => {
  const f = runtime(), input = readFc27StreamlinedInputs(f.root);
  f.user.selectedPersona = 444;
  expect(input.assertCurrent).toThrow();
  f.user.selectedPersona = 902;
  delete f.root.repositories.Item.club.items._collection[1].sbsScore;
  expect(readFc27StreamlinedInputs(f.root).inventory[0].points).toBeNull();
  f.challenge.eligibilityRequirements[0].kvPairs._collection[999] = [1];
  expect(() => readFc27StreamlinedInputs(f.root)).toThrow('ELIGIBILITY_UNVERIFIED');
  f.challenge.isOneClickChallenge = () => false;
  expect(locateFc27StreamlinedPage(f.root)).toBeNull();
  expect(inspectFc27Streamlined(f.root).status).toBe('blocked');
});
it('uses native AND/OR semantics and never matches market versions against an owned item by definition alone', () => {
  const contract = fixtureChallenge();
  const entities = new Map([[1, { definitionId: 2 }]]);
  const root = { UTEvolutionEligibilityVO: class { isValid = true; meetsRequirements = () => true; } };
  const matcher = createFc27StreamlinedMatcher(root, contract, entities);
  expect(matcher.matches({ id: 1, definitionId: 2 }).status).toBe('eligible');
  expect(matcher.matches({ id: null, definitionId: 2 }).status).toBe('unknown');
  expect(matcher.matches({ id: 1, definitionId: 3 }).status).toBe('unknown');
});

it('bundles the read-only inspector and exports no account or item identities', async () => {
  const { root, calls } = runtime();
  const report = await inspectStreamlined({ url: () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/',
    evaluate: source => runInNewContext(source, { globalThis: root, structuredClone }) });
  expect(report).toMatchObject({ status: 'observed', challenge: { id: 61, targetScore: 2500 }, liveExecutionEnabled: false });
  expect(report.challenge.context).toBeUndefined();
  expect(report.inventory).toBeUndefined();
  expect(calls).toEqual([]);
});
