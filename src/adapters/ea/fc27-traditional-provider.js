import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context, readFc27CachedClub, snapshotFc27ClubPlayer } from './fc27-local-read.js';
import { readFc27RunnerPolicy } from './fc27-fsu-read.js';
import { readFc27SbcContract } from './fc27-sbc-contract.js';
import { createFc27ClubReadTransport } from './fc27-club-read.js';
import { createFc27TransactionTransport, verifyFc27Methods } from './fc27-transaction-transport.js';

const fail = reason => { throw new Error(reason); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const at = (root, path) => path.split('.').reduce((value, key) => ownData(value, key), root);
const protectedItem = item => ({ ...item, protected: item.special !== false || item.evolution !== false || item.cosmetic !== false });
const identity = value => Number.isSafeInteger(value) && value > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
export const FC27_SBC_EXECUTION_METHODS = Object.freeze([
  ['UTSquadBuildingChallengeDAO.prototype.getSets', '17c14dbd7d26929eb04ad616ef088bdc076ba3a81f08788aa83ccd239581ea2c'],
  ['UTSquadBuildingChallengeDAO.prototype.getChallengesForSet', '238c93154b271b36affb9e95eb5696d05471cc8d533294a0d0d8848c55e3b693'],
  ['UTSquadBuildingChallengeDAO.prototype.loadChallenge', '04f9ea36c9d79e8ce1f0b0f5e27c10deffb576aafbde4b33e905b99751c3e87e'],
  ['UTSquadBuildingChallengeDAO.prototype.saveChallenge', '5273c0f32805c49e91ca26e924a442048dcc5bc763d979c34c0919793a02d851'],
  ['UTSquadBuildingChallengeDAO.prototype.submitChallenge', '38539de9ad8d2aad8e429029f2cfc87539dc91ef662c0a892dcec5c67220afef'],
]);
export const FC27_SBC_CACHE_METHODS = Object.freeze([
  ['UTItemRepository.prototype.remove', 'e9e10aeb4b55d20100f4003c34df53d90cb2e9f2d21335419a2b5283d084c2e7'],
  ['UTClubRepository.prototype.resetStatsCacheTimestamp', 'a6bb2952a0915a650af1358a4e43d5b3baed01df16fa054652828c82a19bb776'],
  ['events.markClubCacheDirty', '9059b7d8d555643b025c9c6f2e956436da952e3e857720bdce9b4bff70e1de53'],
]);
function values(input, limit = 500) {
  const collection = ownData(input, '_collection') ?? input;
  if (!collection || typeof collection !== 'object') return fail('FC27_PROVIDER_RESPONSE_UNVERIFIED');
  const keys = Object.getOwnPropertyNames(collection).filter(key => key !== 'length');
  if (keys.length > limit) return fail('FC27_PROVIDER_RESPONSE_UNVERIFIED');
  return keys.map(key => ownData(collection, key));
}
function success(reply) {
  if (ownData(reply, 'success') !== true || ownData(reply, 'status') !== 200) return fail('FC27_PROVIDER_READ_UNCONFIRMED');
  const data = ownData(reply, 'response');
  if (!data || typeof data !== 'object') return fail('FC27_PROVIDER_RESPONSE_UNVERIFIED');
  return data;
}
export function projectFc27OwnedPackCount(root, response, reward) {
  const packs = ownData(response, 'purchase');
  if (!Array.isArray(packs) || packs.length > 10000 || at(root, 'PurchaseDisplayGroup.MYPACKS') !== 'mypacks') {
    return fail('FC27_REWARD_BASELINE_UNVERIFIED');
  }
  let total = 0;
  for (const pack of packs) {
    const group = ownData(ownData(pack, 'displayGroup'), 'value');
    if (typeof group !== 'string') return fail('FC27_REWARD_BASELINE_UNVERIFIED');
    if (group !== 'mypacks') continue;
    if (!identity(ownData(pack, 'id'))) return fail('FC27_REWARD_BASELINE_UNVERIFIED');
    if (pack.id !== reward.value) continue;
    if (ownData(pack, 'packType') !== 'CARDPACK' || ownData(pack, 'untradeable') !== !reward.tradable
        || !count(ownData(pack, 'quantity')) || pack.quantity > 10000) return fail('FC27_REWARD_BASELINE_UNVERIFIED');
    total += pack.quantity;
  }
  if (total > 10000) return fail('FC27_REWARD_BASELINE_UNVERIFIED');
  return total;
}
export function projectFc27Submission(reply, target) {
  const data = ownData(reply, 'response');
  const status = ownData(reply, 'status');
  const squads = ownData(data, 'squads');
  const rawWarnings = ownData(data, 'itemViolations');
  let warnings = [];
  if (Array.isArray(squads)) warnings = squads.map(warning => ({ name: ownData(warning, 'squad'), itemIds: ownData(warning, 'playerList') }));
  else if (Array.isArray(rawWarnings)) warnings = rawWarnings;
  warnings = warnings.slice(0, 30).map(warning => ({
    name: typeof ownData(warning, 'name') === 'string' && /^[A-Za-z0-9_ -]{1,80}$/.test(warning.name) ? warning.name : 'UNKNOWN',
    itemIds: Array.isArray(ownData(warning, 'itemIds')) ? warning.itemIds.filter(identity).slice(0, 30) : [],
  }));
  if (ownData(reply, 'success') === true && status === 200 && squads === undefined && rawWarnings === undefined
      && ownData(data, 'setId') === target.setId && ownData(data, 'challengeId') === target.challengeId) {
    return { status: 'confirmed', ...target };
  }
  // 409/explicit client rejection cannot authorize skipValidation or a retry.
  if ([400, 401, 403, 404, 409, 429].includes(status) && ownData(reply, 'success') === false
      || ownData(reply, 'success') === true && status === 200 && Array.isArray(squads) && squads.length > 0) {
    return { status: 'rejected', ...target, code: status, warnings };
  }
  return { status: 'unknown', ...target, code: Number.isInteger(status) ? status : null, warnings };
}

export async function createFc27TraditionalProvider(root, { canWrite = () => false } = {}) {
  const context = readFc27Context(root);
  const runtime = await verifyFc27Methods(root, FC27_SBC_EXECUTION_METHODS);
  const cacheRuntime = await verifyFc27Methods(root, FC27_SBC_CACHE_METHODS);
  const transport = await createFc27TransactionTransport(root, { canWrite });
  const club = await createFc27ClubReadTransport(root);
  const dao = at(root, 'services.SBC.sbcDAO');
  const functions = Object.fromEntries(FC27_SBC_EXECUTION_METHODS.map(([path]) => {
    const key = path.split('.').at(-1);
    const fn = at(root, path);
    if (dao?.[key] !== fn) return fail('FC27_TRANSACTION_RUNTIME_CHANGED');
    return [key, fn];
  }));
  let lastRead = -Infinity;
  let stopped = false;
  const assert = () => {
    if (stopped || !same(context, readFc27Context(root)) || at(root, 'services.SBC.sbcDAO') !== dao
        || Object.keys(functions).some(key => dao[key] !== functions[key])) return fail('FC27_TRANSACTION_CONTEXT_CHANGED');
    runtime(); cacheRuntime(); transport.assert();
  };
  const dirtyCache = () => {
    assert(); root.events.markClubCacheDirty('FC27 traditional SBC');
    if (at(root, 'info.base.clubCache.localDirty') !== true) return fail('FC27_CACHE_RECONCILIATION_UNCONFIRMED');
  };
  const reconcileCache = refs => {
    assert();
    const repo = at(root, 'repositories.Item.club');
    const items = ownData(repo, 'items');
    const collection = ownData(items, '_collection');
    if (!collection || items.remove !== at(root, 'UTItemRepository.prototype.remove')
        || repo.resetStatsCacheTimestamp !== at(root, 'UTClubRepository.prototype.resetStatsCacheTimestamp')) {
      return fail('FC27_CACHE_RECONCILIATION_UNCONFIRMED');
    }
    const cached = refs.map(ref => ({ ref, item: ownData(collection, String(ref.id)) }));
    // Validate every exact identity before any local removal; never remove by definition.
    if (cached.some(({ ref, item }) => item && (ownData(item, 'id') !== ref.id
        || ownData(item, 'definitionId') !== ref.definitionId))) return fail('FC27_CACHE_RECONCILIATION_UNCONFIRMED');
    dirtyCache();
    for (const { ref, item } of cached) if (item) items.remove(ref.id);
    repo.resetStatsCacheTimestamp();
    if (refs.some(ref => ownData(collection, String(ref.id)) !== undefined)) return fail('FC27_CACHE_RECONCILIATION_UNCONFIRMED');
  };
  const readDao = async (key, args) => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 800 - (Date.now() - lastRead))));
    assert(); lastRead = Date.now();
    return new Promise((resolve, reject) => {
      let observable; let done = false; const owner = {};
      const finish = (error, value) => {
        if (done) return;
        done = true; clearTimeout(timer);
        try { observable?.unobserve(owner); } catch { /* Our detached read only. */ }
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => finish(new Error('FC27_PROVIDER_READ_TIMEOUT')), 11000);
      try {
        observable = functions[key].apply(dao, args);
        observable.observe(owner, (_sender, reply) => {
          if (done) return;
          try { assert(); finish(null, success(reply)); } catch (error) { finish(error); }
        });
      } catch { finish(new Error('FC27_PROVIDER_READ_UNCONFIRMED')); }
    });
  };
  const freshRefs = async refs => {
    assert();
    if (!Array.isArray(refs) || refs.length < 1 || refs.length > 11 || refs.some(ref => !identity(ref.id)
        || !identity(ref.definitionId) || ref.pile !== 'club') || new Set(refs.map(ref => ref.id)).size !== refs.length
        || new Set(refs.map(ref => ref.definitionId)).size !== refs.length) return fail('FC27_EXACT_ITEMS_CHANGED');
    // A bounded native query also proves absence when FSU ready would return cached=true.
    const items = await club.readPage({ start: 0, count: 250, definitionIds: refs.map(ref => ref.definitionId) });
    assert();
    if (items.length >= 250 || new Set(items.map(item => item.id)).size !== items.length
        || items.some(item => !refs.some(ref => ref.definitionId === item.definitionId))) return fail('FC27_EXACT_ITEMS_CHANGED');
    return items.filter(item => refs.some(ref => ref.id === item.id && ref.definitionId === item.definitionId)).map(protectedItem);
  };
  const rewardCount = async reward => projectFc27OwnedPackCount(root, success(await transport.request('packs')), reward);
  const unassigned = async () => {
    const response = success(await transport.request('unassigned'));
    const items = ownData(response, 'itemData');
    if (!Array.isArray(items) || items.length > 10000) return fail('FC27_UNASSIGNED_UNVERIFIED');
    return items.length === 0;
  };
  const readInputs = async plan => {
    assert();
    const maxRating = plan.policy?.maxRating ?? plan.maxRating ?? 74;
    const before = readFc27RunnerPolicy(root, maxRating);
    const result = await readFc27SbcContract(root, { setId: plan.set?.id ?? plan.setId });
    assert();
    if (result.status !== 'observed' || !result.methods.saveChallenge || !result.methods.submitChallenge) return fail('FC27_PROVIDER_CONTRACT_UNVERIFIED');
    const unassignedClear = await unassigned();
    const policy = readFc27RunnerPolicy(root, maxRating);
    if (!same(before, policy)) return fail('FC27_ATTEMPT_INPUTS_CHANGED');
    return { contract: result.contract, policy, unassignedClear };
  };
  const targetOf = plan => ({ setId: plan.set.id, challengeId: plan.challenge.id });
  const observeRecovery = async record => {
    const present = await freshRefs(record.itemRefs);
    const data = await readDao('getSets', []);
    const sets = values(ownData(data, 'sets')).filter(set => ownData(set, 'id') === record.setId);
    if (sets.length !== 1 || !count(ownData(sets[0], 'timesCompleted'))) return fail('FC27_RECONCILIATION_UNCONFIRMED');
    const challenges = values(ownData(await readDao('getChallengesForSet', [record.setId]), 'challenges'), 50);
    if (challenges.length !== 1 || ownData(challenges[0], 'id') !== record.challengeId
        || ownData(challenges[0], 'setId') !== record.setId) return fail('FC27_RECONCILIATION_UNCONFIRMED');
    const awards = [['set', sets[0]], ['challenge', challenges[0]]].flatMap(([scope, entity]) =>
      values(ownData(entity, 'awards'), 6).map(reward => ({ scope,
        ...Object.fromEntries(['type', 'value', 'count', 'tradable'].map(key => [key, ownData(reward, key)])) })));
    if (awards.length !== 1 || !same(awards[0], record.reward)) return fail('FC27_RECONCILIATION_UNCONFIRMED');
    const packCount = await rewardCount(record.reward);
    const unassignedClear = await unassigned();
    assert();
    return { context, fresh: true, observedAt: Date.now(), setId: record.setId, challengeId: record.challengeId,
      present: present.map(({ id, definitionId, pile }) => ({ id, definitionId, pile })),
      setTimesCompleted: sets[0].timesCompleted, packId: record.reward.value, packCount, unassignedClear };
  };
  return Object.freeze({
    capabilities: Object.freeze({ verified: true, submitWithoutSave: true, liveAcceptanceVerified: false }),
    async prepareInputs(options) {
      const input = await readInputs(options);
      if (!input.unassignedClear) return fail('FC27_UNASSIGNED_NOT_CLEAR');
      const cached = readFc27CachedClub(root);
      return { ...input, inventory: { schema: 1, context, kind: 'normalized-inventory', status: 'provisional',
        items: cached.items.map(protectedItem) } };
    },
    readInputs,
    async validateItems(plan) { return { context, fresh: true, items: await freshRefs(plan.selected) }; },
    async readRewardBaseline(plan) { return { context, fresh: true, packId: plan.rewards[0].value, count: await rewardCount(plan.rewards[0]) }; },
    async save(plan) {
      assert();
      if (canWrite() !== true || plan.challenge.brickIndices.length) return fail('FC27_SAVE_INPUT_UNVERIFIED');
      const loaded = ownData(await readDao('loadChallenge', [plan.challenge.id, true]), 'squad');
      const slots = ownData(loaded, '_players');
      if (!Array.isArray(slots) || slots.length < 11 || slots.length > 32
          || !same(ownData(loaded, 'simpleBrickIndices'), []) || !same(ownData(loaded, 'customBrickIndices'), [])) {
        return fail('FC27_SAVE_INPUT_UNVERIFIED');
      }
      const players = slots.map((slot, index) => {
        const selected = plan.selected.find(item => item.slot === index);
        const emptyId = ownData(ownData(slot, '_item'), 'id');
        if (ownData(slot, 'index') !== index || index < 11 && !selected || index >= 11 && ![0, -1].includes(emptyId)) {
          return fail('FC27_SAVE_INPUT_UNVERIFIED');
        }
        return { index, itemData: { id: selected?.id ?? emptyId, dream: false } };
      });
      const reply = await transport.request('save', { challengeId: plan.challenge.id,
        players });
      assert();
      return { ...targetOf(plan), status: ownData(reply, 'success') === true && ownData(reply, 'status') === 200 ? 'confirmed' : 'unknown' };
    },
    async readSavedSquad(plan) {
      const response = await readDao('loadChallenge', [plan.challenge.id, true]);
      const squad = ownData(response, 'squad');
      const slots = ownData(squad, '_players');
      if (!Array.isArray(slots) || slots.length < 11 || slots.length > 32
          || !same(ownData(squad, 'simpleBrickIndices'), []) || !same(ownData(squad, 'customBrickIndices'), [])
          || plan.challenge.brickIndices.length) return fail('FC27_SAVED_SQUAD_UNVERIFIED');
      const items = [];
      for (let index = 0; index < slots.length; index++) {
        if (ownData(slots[index], 'index') !== index) return fail('FC27_SAVED_SQUAD_UNVERIFIED');
        const item = ownData(slots[index], '_item');
        if (index < 11) items.push({ ...protectedItem(snapshotFc27ClubPlayer(item, root)), slot: index });
        else if (![0, -1].includes(ownData(item, 'id'))) return fail('FC27_SAVED_SQUAD_UNVERIFIED');
      }
      return { context, fresh: true, ...targetOf(plan), ready: items.length === 11, items };
    },
    async submit(plan, options) {
      assert();
      if (options?.skipValidation !== false || canWrite() !== true) return fail('FC27_LIVE_DISABLED');
      dirtyCache();
      return projectFc27Submission(await transport.request('submit', targetOf(plan)), targetOf(plan));
    },
    async reconcile(plan, _receipt, baseline) {
      const record = { ...targetOf(plan), itemRefs: plan.selected, reward: plan.rewards[0] };
      const evidence = await observeRecovery(record);
      if (evidence.present.length === 0 && evidence.setTimesCompleted === plan.set.timesCompleted + 1) reconcileCache(plan.selected);
      if (evidence.unassignedClear !== true) return fail('FC27_RECONCILIATION_UNCONFIRMED');
      return { ...evidence, progressConfirmed: evidence.setTimesCompleted === plan.set.timesCompleted + 1,
        consumed: evidence.present.length === 0 ? plan.selected.map(({ id, definitionId, pile }) => ({ id, definitionId, pile })) : [],
        rewardDelta: evidence.packCount - baseline.count };
    },
    observeRecovery,
    async reconcileRecoveredCache(record, evidence) {
      assert();
      if (evidence.context !== context || evidence.fresh !== true || evidence.present.length !== 0
          || Date.now() - evidence.observedAt > 15000 || evidence.setId !== record.setId
          || evidence.challengeId !== record.challengeId || evidence.setTimesCompleted !== record.setTimesCompleted + 1) {
        return fail('FC27_CACHE_RECONCILIATION_UNCONFIRMED');
      }
      reconcileCache(record.itemRefs);
    },
    cancel() { stopped = true; transport.cancel(); },
  });
}
