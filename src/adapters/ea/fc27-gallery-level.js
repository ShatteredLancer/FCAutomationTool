import { readFc27Context } from './fc27-local-read.js';
import { ownData, contextKey } from '../../fc27/prelaunch-contract.js';
import { projectGalleryLevelMilestones } from '../../gallery/level-milestones.js';

// Reviewed in the current FC27 Web App on 2026-10-26: getCategories only GETs
// /scmp/objective/categories/all, then creates detached metadata entities.
export const FC27_GALLERY_LEVEL_CATEGORIES_HASH = 'bcbab0fd238e5d4b53f93c3b22fa6d9250cf7e83790b6c0b8f01db60e68d1872';
const values = object => Object.values(ownData(object, '_collection') ?? object ?? {});
const method = (object, key) => {
  for (let depth = 0; object && depth < 5; depth++, object = Object.getPrototypeOf(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor) return descriptor.value;
  }
  return null;
};
const detach = categories => categories.flatMap(category => values(ownData(category, 'groups')).map(group => ({
  objectives: values(ownData(group, 'objectives')).map(objective => ({
    id: ownData(objective, 'id'), title: ownData(objective, 'title'), description: ownData(objective, 'description'),
    state: ownData(objective, '_state'), companion: ownData(objective, 'companion'),
    rewards: values(ownData(ownData(objective, 'rewards'), 'rewards')).map(reward => {
      const data = ownData(ownData(reward, 'item'), '_staticData');
      const value = ownData(data, 'description') || ownData(reward, 'displayName');
      return typeof value === 'string' ? value.slice(0, 300) : '';
    }).filter(Boolean),
  })),
})));

export function createFc27GalleryLevelReader(root, { get = async () => null, set = async () => {}, now = Date.now } = {}) {
  const snapshots = new Map(), pending = new Map();
  const scope = () => contextKey(readFc27Context(root), 'gallery-level');
  const same = expected => { if (scope() !== expected) throw Error('FC27_GALLERY_CONTEXT_CHANGED'); };
  const noteKey = expected => `fcat-fc27-gallery-console-level-v1:${expected}`;
  return Object.freeze({ scope,
    peek() { try { return snapshots.get(scope()) ?? null; } catch { return null; } },
    async readNote() {
      const expected = scope(), note = await get(noteKey(expected), null); same(expected);
      return note?.source === 'console-user-recorded' && Number.isSafeInteger(note.level) && note.level > 0
        && note.level <= 1000 && Number.isSafeInteger(note.recordedAt) && note.recordedAt >= 0 && note.recordedAt <= now()
        ? { level: note.level, recordedAt: note.recordedAt, source: note.source } : null;
    },
    async saveNote(level) {
      if (!Number.isSafeInteger(level) || level < 1 || level > 1000) throw Error('FC27_GALLERY_LEVEL_NOTE_INVALID');
      const expected = scope(), note = { level, recordedAt: now(), source: 'console-user-recorded' };
      await set(noteKey(expected), note); same(expected);
      const saved = await get(noteKey(expected), null); same(expected);
      if (JSON.stringify(saved) !== JSON.stringify(note)) throw Error('FC27_GALLERY_LEVEL_NOTE_UNCONFIRMED');
      return note;
    },
    refresh() {
      let expected;
      try { expected = scope(); } catch { return Promise.resolve({ status: 'unavailable', reason: 'context-unavailable', exactLevel: null }); }
      if (pending.has(expected)) return pending.get(expected);
      const run = (async () => {
        try {
          const service = ownData(ownData(root, 'services'), 'Objectives'), dao = ownData(service, 'objectivesDAO');
          const read = method(dao, 'getCategories');
          const states = ownData(root, 'ObjectiveProgressState');
          if (ownData(root, 'GAME_NAME') !== 'fc27' || typeof read !== 'function'
              || ownData(states, 'COMPLETED') !== 2 || ownData(states, 'REDEEMED') !== 3 || ownData(states, 'IN_PROGRESS') !== 1) throw Error('FC27_GALLERY_LEVEL_RUNTIME_UNVERIFIED');
          const hash = Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',
            new globalThis.TextEncoder().encode(Function.prototype.toString.call(read)))), value => value.toString(16).padStart(2, '0')).join('');
          if (hash !== FC27_GALLERY_LEVEL_CATEGORIES_HASH) throw Error('FC27_GALLERY_LEVEL_RUNTIME_UNVERIFIED');
          same(expected);
          const result = await new Promise((resolve, reject) => {
            const owner = {}; let observable, finished = false;
            const finish = (error, value) => {
              if (finished) return; finished = true; clearTimeout(timer);
              try { observable?.unobserve(owner); } catch { /* Observer cleanup only. */ }
              if (error) reject(error); else resolve(value);
            };
            const timer = setTimeout(() => finish(Error('FC27_GALLERY_LEVEL_TIMEOUT')), 15000);
            try {
              observable = read.call(dao);
              observable.observe(owner, (_sender, response) => {
                try {
                  same(expected);
                  if (response?.success !== true || response.status !== 200 || !Array.isArray(response.response?.categories)
                      || response.response.categories.length > 64) throw Error('FC27_GALLERY_LEVEL_READ_UNCONFIRMED');
                  finish(null, projectGalleryLevelMilestones(detach(response.response.categories), now()));
                } catch (error) { finish(error); }
              });
            } catch (error) { finish(error); }
          });
          same(expected); snapshots.set(expected, result); return result;
        } catch (error) {
          return { ...(snapshots.get(expected) ?? {}), status: 'unavailable', stale: true, exactLevel: null,
            reason: /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'FC27_GALLERY_LEVEL_READ_UNCONFIRMED' };
        }
      })().finally(() => pending.delete(expected));
      pending.set(expected, run); return run;
    },
  });
}
