import { createFc27ClubReadTransport } from './fc27-club-read.js';
import { createEaInventoryAdapter } from './inventory.js';
import { fodderPoolQueries, matchesFodderPool } from '../../gallery/fodder-pool.js';

const fail = reason => { throw Error(reason); };
const id = value => Number.isSafeInteger(value) && value > 0;

// Native Club reads stay local; historical Gallery collection is not ownership.
// Read the Club once, not once per public card. Revalidate each selected Club
// entity immediately before listing through the same reviewed transport.
export function createFc27GalleryListingInventory(root, { createTransport = createFc27ClubReadTransport,
  assertCurrent = () => {} } = {}) {
  const entities = new Map();
  let transport = null;
  const reader = async () => transport ??= await createTransport(root, { nativeReauth: true, onEntity: entity => entities.set(entity.id, entity) });
  const read = async query => {
    assertCurrent(); const rows = await (await reader()).readPage(query); assertCurrent(); return rows;
  };
  return {
    clubItems: () => [...entities.values()],
    resolve(ref) {
      const item = entities.get(ref.id);
      return item?.definitionId === ref.definitionId ? { item, pile: 'club' } : null;
    },
    async scan(target) {
      if (!target?.set?.id || !['futgg', 'fodder'].includes(target.source)
        || !target.set.id.startsWith(`${target.source}:`)) fail('FC27_GALLERY_LISTING_SET_UNAVAILABLE');
      let matches;
      if (target.source === 'fodder') {
        fodderPoolQueries(target.set); // Validates all conditions before reading.
        matches = item => matchesFodderPool(target.set, item);
      } else {
        if (!Array.isArray(target.pool?.items) || target.pool.candidateOnly === true
          || target.pool.complete !== true) fail('FC27_GALLERY_LISTING_SET_POOL_INCOMPLETE');
        if (`futgg:${target.pool.setId}` !== target.set.id) fail('FC27_GALLERY_LISTING_SET_UNAVAILABLE');
        const ids = new Set(target.pool.items.map(row => row.eaId));
        if (!ids.size || [...ids].some(value => !id(value))) fail('FC27_GALLERY_LISTING_SET_UNAVAILABLE');
        matches = item => ids.has(item.definitionId);
      }
      assertCurrent(); const count = await (await reader()).readCount(); assertCurrent();
      const seen = new Set();
      for (let start = 0; start < count; start += 250) {
        const rows = await read({ start, count: Math.min(250, count - start), definitionIds: [] });
        if (rows.length !== Math.min(250, count - start)) fail('FC27_GALLERY_LISTING_CLUB_INCOMPLETE');
        for (const row of rows) {
          if (seen.has(row.id) || !entities.has(row.id)) fail('FC27_GALLERY_LISTING_CLUB_INCOMPLETE');
          seen.add(row.id);
        }
      }
      const transfer = createEaInventoryAdapter(root).readPile('transfer');
      const occupied = new Set(transfer.map(item => Number(item.id)));
      const club = [...entities.values()].filter(item => !occupied.has(item.id) && matches(item));
      return [...club.map(item => ({ id: item.id, definitionId: item.definitionId, pile: 'club' })),
        ...transfer.filter(item => item.type === 'player' && matches(item))
          .map(item => ({ id: Number(item.id), definitionId: Number(item.definitionId), pile: 'transfer' }))];
    },
    async hydrate(ref) {
      if (ref.pile !== 'club') return;
      entities.delete(ref.id);
      const rows = await read({ start: 0, count: 250, definitionIds: [ref.definitionId] });
      return rows.some(row => row.id === ref.id && row.definitionId === ref.definitionId && row.pile === 'club') && entities.has(ref.id);
    },
    async validate(ref) {
      if (ref.pile === 'club' && !await this.hydrate(ref)) fail('FC27_GALLERY_LISTING_ITEM_CHANGED');
    },
  };
}

// A local runtime facade lets the existing trade adapter use fresh entities
// without changing the shared FC26 adapter or writing to EA/FSU repositories.
// Native methods retain their original receiver; only Club lookup is replaced.
export function galleryListingInventoryRuntime(root, inventory) {
  const overlay = (target, overrides) => new Proxy(target ?? {}, { get(value, key) {
    if (Object.hasOwn(overrides, key)) return overrides[key]();
    const result = Reflect.get(value, key, value);
    return typeof result === 'function' ? result.bind(value) : result;
  } });
  const club = { get items() { return { _collection: inventory.clubItems() }; } };
  const itemRepo = value => overlay(value, { club: () => club });
  const repositories = overlay(root.repositories, { Item: () => itemRepo(root.repositories?.Item) });
  const item = overlay(root.services?.Item, { itemDao: () => overlay(root.services?.Item?.itemDao, {
    itemRepo: () => itemRepo(root.services?.Item?.itemDao?.itemRepo),
  }) });
  const services = overlay(root.services, { Item: () => item });
  return overlay(root, { repositories: () => repositories, services: () => services });
}
