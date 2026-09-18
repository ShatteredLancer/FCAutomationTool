import { createSeasonContext } from '../../../src/fc27/prelaunch-contract.js';

const MAX_ITEMS = 20000;
const PAGE_SIZE = 250;

function sameContext(a, b) {
  try {
    const left = createSeasonContext(a);
    const right = createSeasonContext(b);
    return left.season === right.season && left.accountScope === right.accountScope
      && left.platform === right.platform;
  } catch { return false; }
}

function assertContext(readContext, expected) {
  const current = readContext();
  if (!sameContext(expected, current)) throw new Error('FC27_CLUB_SCOPE_CHANGED');
  return current;
}

function assertItems(value) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new Error('FC27_CLUB_PAGE_INVALID');
  for (const item of value) {
    if (!item || !Number.isSafeInteger(item.id) || item.id < 1
        || !Number.isSafeInteger(item.definitionId) || item.definitionId < 1
        || item.type !== 'player' || typeof item.safetyFingerprint !== 'string'
        || !item.safetyFingerprint || item.safetyFingerprint.length > 2048) {
      throw new Error('FC27_CLUB_ITEM_INVALID');
    }
  }
  return value;
}

function assertUnique(items) {
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('FC27_CLUB_DUPLICATE_ITEM');
}

// Completeness is provisional: separate requests do not form an atomic EA snapshot.
// Consumers still need policy normalization and exact validation before any use.
export function createClubInspectionInventory({ readContext, readCount, readPage }) {
  if (typeof readContext !== 'function' || typeof readCount !== 'function' || typeof readPage !== 'function') {
    throw new TypeError('FC27_CLUB_READERS_REQUIRED');
  }
  let busy = false;
  let snapshot = null;
  let status = 'not-ready';

  const clear = () => { snapshot = null; status = 'not-ready'; };

  async function refreshClub() {
    if (busy) throw new Error('FC27_CLUB_BUSY');
    busy = true;
    clear();
    let expected;
    try {
      expected = createSeasonContext(readContext());
      if (expected.season !== '27') throw new Error('FC27_CLUB_SCOPE_CHANGED');
      const firstCount = await readCount({ context: expected });
      if (!Number.isSafeInteger(firstCount) || firstCount < 0 || firstCount > MAX_ITEMS) {
        throw new Error('FC27_CLUB_COUNT_INVALID');
      }
      const items = [];
      let start = 0;
      const requestSize = Math.max(1, Math.min(PAGE_SIZE, firstCount || 1));
      while (true) {
        assertContext(readContext, expected);
        const page = assertItems(await readPage({ context: expected, start, count: requestSize, definitionIds: [] }));
        assertContext(readContext, expected);
        if (page.length > requestSize) throw new Error('FC27_CLUB_PAGE_INVALID');
        assertUnique(page);
        items.push(...page);
        if (items.length > firstCount) throw new Error('FC27_CLUB_COUNT_OVERFLOW');
        start += page.length;
        if (page.length < requestSize) break;
        if (start >= firstCount) {
          // An exact page boundary needs an affirmative terminal empty page.
          const terminal = assertItems(await readPage({ context: expected, start, count: requestSize, definitionIds: [] }));
          assertUnique(terminal);
          if (terminal.length) throw new Error('FC27_CLUB_COUNT_OVERFLOW');
          break;
        }
      }
      if (items.length !== firstCount) throw new Error('FC27_CLUB_COUNT_MISMATCH');
      assertUnique(items);
      assertContext(readContext, expected);
      const finalCount = await readCount({ context: expected });
      assertContext(readContext, expected);
      if (finalCount !== firstCount) throw new Error('FC27_CLUB_COUNT_DRIFT');
      snapshot = Object.freeze({ schema: 1, context: expected, kind: 'fresh-club-inspection',
        status: 'provisional', complete: true, expectedCount: firstCount,
        liveExecutionEnabled: false,
        items: Object.freeze(items.map(item => Object.freeze({ ...item }))) });
      status = 'provisional';
      return Object.freeze({ status: 'refreshed', context: expected });
    } catch (error) {
      clear();
      throw error;
    } finally { busy = false; }
  }

  async function validateClubPlayers(refs) {
    if (!Array.isArray(refs) || refs.length < 1 || refs.length > 50
        || new Set(refs.map(ref => ref?.id)).size !== refs.length
        || refs.some(ref => !Number.isSafeInteger(ref?.id) || ref.id < 1
          || !Number.isSafeInteger(ref?.definitionId) || ref.definitionId < 1
          || typeof ref.safetyFingerprint !== 'string' || !ref.safetyFingerprint || ref.safetyFingerprint.length > 2048)) {
      throw new Error('FC27_CLUB_INVALID_REFS');
    }
    if (busy) throw new Error('FC27_CLUB_BUSY');
    refs = refs.map(ref => Object.freeze({ id: ref.id, definitionId: ref.definitionId, safetyFingerprint: ref.safetyFingerprint }));
    busy = true;
    try {
      const expected = snapshot?.context ? createSeasonContext(snapshot.context) : createSeasonContext(readContext());
      assertContext(readContext, expected);
      const definitions = [...new Set(refs.map(ref => ref.definitionId))];
      const page = assertItems(await readPage({ context: expected, start: 0, count: PAGE_SIZE, definitionIds: definitions }));
      if (page.length > PAGE_SIZE) throw new Error('FC27_CLUB_PAGE_INVALID');
      assertUnique(page);
      if (page.some(item => !definitions.includes(item.definitionId))) throw new Error('FC27_CLUB_UNEXPECTED_DEFINITION');
      const items = refs.map(ref => {
        const byId = page.find(item => item.id === ref.id);
        if (byId && byId.definitionId !== ref.definitionId) throw new Error('FC27_CLUB_UNEXPECTED_DEFINITION');
        const item = page.find(candidate => candidate.id === ref.id && candidate.definitionId === ref.definitionId);
        if (!item || item.safetyFingerprint !== ref.safetyFingerprint) throw new Error('FC27_CLUB_ITEM_CHANGED_OR_MISSING');
        return Object.freeze({ ...item });
      });
      assertContext(readContext, expected);
      return Object.freeze({ status: 'validated', context: expected, items: Object.freeze(items) });
    } catch (error) {
      clear();
      throw error;
    } finally { busy = false; }
  }

  function currentSnapshot() {
    try { if (snapshot && !sameContext(snapshot.context, readContext())) clear(); }
    catch { clear(); }
    return snapshot;
  }

  return Object.freeze({
    describe: () => {
      currentSnapshot();
      return Object.freeze({ context: snapshot?.context ?? null, status: busy ? 'loading' : status, complete: snapshot?.complete === true });
    },
    getSnapshot: currentSnapshot,
    refreshClub,
    validateClubPlayers,
  });
}
