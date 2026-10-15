import observation from '../fixtures/fc27-streamlined-set-observation-2026-10-15.json';

// Public native factory in a local clock/dependency fixture, with no EA service.
export function observedSet(at, progress = {}) {
  const Entity = new Function('o', 'EAHashTable', `return (${observation.constructorSource})`)(function () {}, class {});
  const create = new Function('JSUtils', 'UTSBCSetEntity', 'Date', `return (${observation.factorySource})`)(
    { isNumber: value => typeof value === 'number', isEmpty: value => value == null || value === '' }, Entity, { now: () => at });
  return create.call({}, { setId: 31, endTime: 3600, repeats: 1, repeatabilityMode: 'REFRESH',
    timesCompleted: 0, challengesCompletedCount: 0, ...progress });
}
