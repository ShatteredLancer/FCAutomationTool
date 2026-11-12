import vm from 'node:vm';
import { vi } from 'vitest';
import observation from '../fixtures/fc27-buy-method-observation-2026-10-09.json';

// Execute the reviewed EA body, not a reimplementation of its duplicate branch.
export function nativeMoveHarness({ onMove = () => {}, onAdd = () => {}, duplicates = [] } = {}) {
  class Observable {
    observe(owner, callback) { this.owner = owner; this.callback = callback; }
    unobserve() { this.callback = null; }
    notify(reply) { queueMicrotask(() => this.callback?.(this, reply)); }
  }
  const reply = value => { const observable = new Observable(); observable.notify(value); return observable; };
  const itemDao = { move: vi.fn((items, pile) => { onMove(items, pile);
    return reply({ success: true, status: 200, response: { itemData: items.map(item => ({ id: item.id, success: true })) } }); }) };
  const source = observation.methods.find(row => row.path === 'UTItemService.prototype.move').decoded;
  const decoder = source.match(/var\s+_0x[\da-f]+=(_0x[\da-f]+)/)[1];
  const globals = { [decoder]: () => {}, EAObservable: Observable,
    UTServiceResponseDTO: class { success = false; status = 0; }, EAHashTable: Map,
    ItemPile: { ANY: 0, CLUB: 7, TRANSFER: 5, PURCHASED: 1, STORAGE: 8 },
    repositories: { Item: { isPileFull: () => false, remove() {}, add: onAdd, setDirty() {} } },
    JSUtils: { valToArray: x => Array.isArray(x) ? x : [x], find: (xs, fn) => xs.find(fn),
      isObject: x => !!x && typeof x === 'object', isString: x => typeof x === 'string', isEmpty: x => !x },
    DebugUtils: { Assert() {} }, getDefaultDispatcher: () => ({ notify() {} }),
    AppNotification: {}, services: { Squad: { removeItemsFromSquads() {} },
      Notification: { queue() {} }, Localization: { localize: key => key } }, UINotificationType: {},
  };
  const service = { move: vm.runInNewContext(`(${source})`, globals), itemDao,
    requestItemsById: vi.fn(() => reply({ success: true, status: 200, response: { items: duplicates } })),
    removeItems() {}, replaceItemInConceptSquads() {} };
  const decorate = item => Object.assign(item, { isConsumable: () => false, isClubConsumable: () => false,
    isDuplicate() { return this.duplicateId > 0; }, clearAuction() {}, isPlayer: () => true });
  return { service, decorate };
}
