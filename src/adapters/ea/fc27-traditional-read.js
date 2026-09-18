import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context } from './fc27-local-read.js';
import { inspectInProgressSquad } from './fc27-sbc-read.js';

function values(collection, limit) {
  const raw = ownData(collection, '_collection') ?? collection;
  if (!raw || typeof raw !== 'object') throw new Error('FC27_CHALLENGE_COLLECTION_UNAVAILABLE');
  const keys = Object.keys(raw);
  if (keys.length > limit) throw new Error('FC27_CHALLENGE_COLLECTION_LIMIT');
  return keys.map(key => ownData(raw, key));
}
function sets(root) {
  const repository = ownData(ownData(ownData(root, 'services'), 'SBC'), 'repository');
  return values(ownData(repository, 'sets'), 500);
}

export function listFc27InProgressChallenges(root) {
  readFc27Context(root);
  const targets = [];
  for (const set of sets(root)) {
    const collection = ownData(set, 'challenges');
    if (!collection) continue;
    for (const challenge of values(collection, 50)) {
      const id = ownData(challenge, 'id');
      const setId = ownData(set, 'id');
      if (ownData(challenge, 'status') !== 'IN_PROGRESS' || ownData(challenge, 'setId') !== setId
          || !Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(setId) || setId <= 0) continue;
      const name = ownData(challenge, 'name');
      targets.push({ id, setId, name: typeof name === 'string' && name.length <= 160 ? name : `Challenge ${id}` });
    }
  }
  return targets;
}

export function normalizeFc27TraditionalChallenge({ context, setId, challenge, layout, keys, scopes }) {
  const id = ownData(challenge, 'id');
  if (ownData(challenge, 'setId') !== setId || ownData(challenge, 'status') !== 'IN_PROGRESS'
      || ownData(challenge, 'eligibilityOperation') !== 'AND' || layout.status !== 'observed'
      || layout.setId !== setId || layout.challengeId !== id || layout.slotCount !== 11
      || ownData(keys, 'PLAYER_MIN_OVR') !== 26 || ownData(keys, 'PLAYER_MAX_OVR') !== 28
      || ownData(scopes, 'GREATER') !== 0 || ownData(scopes, 'EXACT') !== 2) {
    throw new Error('FC27_CHALLENGE_UNVERIFIED');
  }
  const count = layout.requiredPlayerCount;
  const raw = values(ownData(challenge, 'eligibilityRequirements'), 16);
  if (!raw.length || !Number.isInteger(count) || count < 1 || count > 11) throw new Error('FC27_REQUIREMENTS_UNVERIFIED');
  const requirements = [{ kind: 'player-count', count }];
  for (const rule of raw) {
    if (ownData(rule, 'count') !== count || ![0, 2].includes(ownData(rule, 'scope'))) throw new Error('FC27_REQUIREMENT_UNSUPPORTED');
    const pairs = ownData(ownData(rule, 'kvPairs'), '_collection');
    const codes = pairs && Object.keys(pairs);
    if (codes?.length !== 1 || !['26', '28'].includes(codes[0])) throw new Error('FC27_REQUIREMENT_UNSUPPORTED');
    const range = ownData(pairs, codes[0]);
    if (!Array.isArray(range) || range.length !== 1 || !Number.isInteger(range[0]) || range[0] < 1 || range[0] > 99) {
      throw new Error('FC27_REQUIREMENT_UNSUPPORTED');
    }
    requirements.push({ kind: codes[0] === '26' ? 'player-min-overall' : 'player-max-overall', count, value: range[0] });
  }
  return { schema: 1, context, mechanism: 'traditional', requirementsOperation: 'AND', completed: false,
    setId, id, slotCount: layout.slotCount, brickIndices: [...layout.simpleBrickIndices, ...layout.customBrickIndices], requirements };
}

export async function readFc27TraditionalChallenge(root, { setId, id }) {
  const context = readFc27Context(root);
  const find = () => {
    const matchedSets = sets(root).filter(set => ownData(set, 'id') === setId);
    const matches = matchedSets.length === 1 ? values(ownData(matchedSets[0], 'challenges'), 50)
      .filter(challenge => ownData(challenge, 'id') === id) : [];
    if (matches.length !== 1) throw new Error('FC27_CHALLENGE_UNVERIFIED');
    return matches[0];
  };
  const challenge = find();
  const layout = await inspectInProgressSquad({ setId, challengeId: id }, root);
  if (challenge !== find() || JSON.stringify(readFc27Context(root)) !== JSON.stringify(context)) throw new Error('FC27_CHALLENGE_CHANGED');
  return normalizeFc27TraditionalChallenge({ context, setId, challenge, layout,
    keys: ownData(root, 'SBCEligibilityKey'), scopes: ownData(root, 'SBCEligibilityScope') });
}
