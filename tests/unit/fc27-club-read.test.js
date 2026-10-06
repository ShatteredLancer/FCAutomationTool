import { expect, it, vi } from 'vitest';
import { FC27_CLUB_READ_METHODS, createFc27ClubReadTransport } from '../../src/adapters/ea/fc27-club-read.js';
import { observeFc27ItemFactory } from '../../src/adapters/ea/fc27-item-factory-observer.js';

function fixture() {
  const calls = [];
  let callback;
  const response = { success: true, status: 200, response: { stat: [{ type: 'players', typeValue: 2 }] } };
  class EAHttpRequest {
    setRequestBody(body) { this.requestBody = body; }
    send() { throw new Error('not direct'); }
    abort() { calls.push('abort'); }
    observe(_observer, fn) { callback = fn; }
    unobserve() { calls.push('unobserve'); }
  }
  class UTHttpRequest extends EAHttpRequest {
    setPath(path) { this.url = `https://utas.test.ea.com${path}`; }
    send() { calls.push(this); if (!response.timeout) callback(response.wrongOwner ? {} : this, response); }
  }
  class UTItemEntityFactory {
    createItem(data) {
      return { ...data, definitionId: data.resourceId, type: 'player', utasPile: 7, _rating: 71, _rareflag: 0,
        upgrades: null, concept: false, cosmetics: [], _hyperCosmeticDTOs: {}, leagueId: 10,
        startTime: -1, endTime: -1, loans: -1, limitedUseType: 0, tradable: false,
        state: 'free', _auction: { _tradeState: 'inactive' } };
    }
  }
  const club = { year: 2027, sku: 'synthetic27', platform: 'PSN' };
  const persona = { id: 9002, _sku: club.sku, clubs: { _collection: { [club.sku]: club } } };
  const user = { id: 9001, selectedPersona: persona.id, _personas: { _collection: { [persona.id]: persona } } };
  const root = { APP_YEAR: 2027, APP_YEAR_SHORT: 27, GAME_NAME: 'fc27',
    services: { User: { currentUserId: user.id, repository: { _collection: { [user.id]: user } } },
      Club: { clubDao: { authDelegate: {} } } },
    UTHttpRequest, EAHttpRequest, UTItemEntityFactory, factories: { Item: new UTItemEntityFactory() },
    HttpRequestMethod: { GET: 'GET', POST: 'POST' }, ItemType: { PLAYER: 'player' }, ItemPile: { CLUB: 7 },
    ItemRarity: { NONE: 0, RARE: 1 }, LimitedUseType: { NONE: 0 }, AuctionTradeStateEnum: { ACTIVE: 'active', INACTIVE: 'inactive' } };
  const hashes = new Map(FC27_CLUB_READ_METHODS.map(([path, hash]) => {
    const fn = path.split('.').reduce((object, key) => object[key], root);
    return [Function.prototype.toString.call(fn), hash];
  }));
  root.crypto = { subtle: { digest: vi.fn(async (_algo, bytes) => {
    const hash = hashes.get(new TextDecoder().decode(bytes)) ?? '0'.repeat(64);
    return Uint8Array.from(hash.match(/../g).map(pair => parseInt(pair, 16))).buffer;
  }) } };
  return { root, response, calls, user };
}

it('uses an owned native request, disables retries and exports fresh count only', async () => {
  const { root, calls } = fixture();
  const transport = await createFc27ClubReadTransport(root);
  expect(await transport.readCount()).toBe(2);
  expect(calls[0]).toMatchObject({ requestType: 'GET', doRetry: false, doReauth: false,
    url: 'https://utas.test.ea.com/ut/game/fc27/club/stats/club' });
  expect(calls).toContain('unobserve');
  expect(transport.getRequestCount()).toBe(1);
});

it('allows Gallery to use native 401 session renewal and its native resend', async () => {
  const { root, calls } = fixture();
  const transport = await createFc27ClubReadTransport(root, { nativeReauth: true });
  await transport.readCount();
  expect(calls[0]).toMatchObject({ doReauth: true, doRetry: true });
});

it('accepts the reviewed FC27-27 current request runtime compatibility set', async () => {
  const { root } = fixture();
  const current = [
    '2397854164bed3b80e1250dc595bb87f278beac64afa9a665086b91dcdb35925',
    '76996922678762db2333635fa82497a8cf0c1af13f8faf36222c0257504bc6d1',
    'a76f0ea6f31e1a7a2183347d5c8f4867a2d85b9eacf083b1dcd58b8dffcce0df',
    'da2f34a13796aff01549443c202cf642dd03f1b2cb5c59fd7dc97ee128e51e81',
    'd19611a15440170b86573c0de3ddcc378cdc9990372fcade371af71383175452',
    'b5a39fadfeba1ca87b2e8c7a8d20b3f211d46a2ea36238bf90e5e59b6fe7a3e9',
    'a683769393a3a6d7116e57e54a08d76308f05b8c0a5afc262036075d59409419',
  ];
  const sourceToHash = new Map(FC27_CLUB_READ_METHODS.slice(0, 7).map(([path], index) => [
    Function.prototype.toString.call(path.split('.').reduce((object, key) => object[key], root)), current[index],
  ]));
  root.crypto.subtle.digest = vi.fn(async (_algo, bytes) => {
    const hash = sourceToHash.get(new TextDecoder().decode(bytes)) ?? '0'.repeat(64);
    return Uint8Array.from(hash.match(/../g).map(pair => parseInt(pair, 16))).buffer;
  });
  await expect(createFc27ClubReadTransport(root)).resolves.toBeTruthy();
});

it('posts only fixed Club search fields and materializes only the exact response entities', async () => {
  const { root, response, calls } = fixture();
  response.response = { itemData: [{ id: 1, resourceId: 101, itemType: 'player' }] };
  const transport = await createFc27ClubReadTransport(root);
  const items = await transport.readPage({ start: 0, count: 250, definitionIds: [101, 102] });
  expect(calls[0]).toMatchObject({ requestType: 'POST', requestBody: { type: 'player', start: 0, count: 250, defId: '101,102' } });
  expect(items[0]).toMatchObject({ id: 1, definitionId: 101, rating: 71, activeTrade: false, locked: null });
});

it('blocks unreviewed methods before network and detects replacement after validation', async () => {
  const { root, calls } = fixture();
  const transport = await createFc27ClubReadTransport(root);
  root.UTHttpRequest.prototype.send = () => {};
  await expect(createFc27ClubReadTransport(root)).rejects.toThrow('RUNTIME_UNVERIFIED');
  await expect(transport.readCount()).rejects.toThrow('RUNTIME_UNVERIFIED');
  expect(calls).toEqual([]);
});

it.each(['fcat', 'external', 'both'])('reads exact Club entities with a %s factory wrapper', async kind => {
  const { root, response, calls } = fixture();
  response.response = { itemData: [{ id: 1, resourceId: 101, itemType: 'player' }] };
  const proto = root.UTItemEntityFactory.prototype, original = proto.createItem;
  if (kind !== 'fcat') proto.createItem = function(raw) { return { ...original.call(this, raw), gradingScore: 20 }; };
  if (kind !== 'external') proto.createItem = observeFc27ItemFactory(proto.createItem, () => {});
  const transport = await createFc27ClubReadTransport(root);
  expect(await transport.readPage({ start: 0, count: 20, definitionIds: [101] }))
    .toMatchObject([{ id: 1, definitionId: 101, concept: false }]);
  proto.createItem = function() {};
  await expect(transport.readCount()).rejects.toThrow('RUNTIME_UNVERIFIED');
  expect(calls.filter(call => typeof call === 'object')).toHaveLength(1);
});

it.each([{ id: 2 }, { definitionId: 999 }, { type: 'manager' }, { concept: true }])
('rejects altered owned-card identity from an external wrapper %j', async patch => {
  const { root, response } = fixture();
  response.response = { itemData: [{ id: 1, resourceId: 101, itemType: 'player' }] };
  const original = root.UTItemEntityFactory.prototype.createItem;
  root.UTItemEntityFactory.prototype.createItem = function(raw) { return { ...original.call(this, raw), ...patch }; };
  await expect((await createFc27ClubReadTransport(root)).readPage({ start: 0, count: 20, definitionIds: [101] }))
    .rejects.toThrow('ENTITY_UNVERIFIED');
});

it.each([304, 401, 429, 500])('refuses status %s without retry or fallback', async status => {
  const { root, response, calls } = fixture();
  response.status = status;
  const transport = await createFc27ClubReadTransport(root);
  await expect(transport.readCount()).rejects.toThrow(`HTTP_${status}`);
  await expect(transport.readCount()).rejects.toThrow('READ_BLOCKED');
  expect(calls.filter(value => typeof value === 'object')).toHaveLength(1);
});

it.each([{}, { itemData: null }, { itemData: [], unknownPlayers: [{ id: 1 }] },
  { itemData: [{ id: 1, resourceId: 101, itemType: 'manager' }] },
  { itemData: [{ id: 1, resourceId: 101, count: 1 }] }])('rejects unknown payload shapes', async body => {
  const { root, response } = fixture();
  response.response = body;
  const transport = await createFc27ClubReadTransport(root);
  await expect(transport.readPage({ start: 0, count: 1, definitionIds: [] })).rejects.toThrow('PAYLOAD_UNVERIFIED');
});

it('accepts explicit empty itemData and rejects mismatched request owners', async () => {
  const { root, response } = fixture();
  response.response = { itemData: [] };
  const transport = await createFc27ClubReadTransport(root);
  expect(await transport.readPage({ start: 0, count: 1, definitionIds: [] })).toEqual([]);
  const other = fixture();
  other.response.wrongOwner = true;
  await expect((await createFc27ClubReadTransport(other.root)).readCount()).rejects.toThrow('OWNER_MISMATCH');
});

it.each([false, true])('times out, cancels native renewal=%s, and does not permit another read', async nativeReauth => {
  vi.useFakeTimers();
  try {
    const { root, response, calls } = fixture();
    response.timeout = true;
    const transport = await createFc27ClubReadTransport(root, { nativeReauth });
    const pending = expect(transport.readCount()).rejects.toThrow('READ_TIMEOUT');
    await vi.advanceTimersByTimeAsync(16001);
    await pending;
    expect(calls).toContain('abort');
    expect(calls.find(value => typeof value === 'object')).toMatchObject({ doRetry: false, doReauth: false });
    await expect(transport.readCount()).rejects.toThrow('READ_BLOCKED');
  } finally { vi.useRealTimers(); }
});

it('blocks invalid queries and account changes before network', async () => {
  const { root, user, calls } = fixture();
  const transport = await createFc27ClubReadTransport(root);
  await expect(transport.readPage({ start: 0, count: 999, definitionIds: [] })).rejects.toThrow('QUERY_INVALID');
  user.selectedPersona = 9003;
  await expect(transport.readCount()).rejects.toThrow('CONTEXT_UNAVAILABLE');
  expect(calls).toEqual([]);
});

it('paces successive reads and rejects concurrent requests', async () => {
  vi.useFakeTimers();
  try {
    const { root, calls } = fixture();
    const transport = await createFc27ClubReadTransport(root);
    expect(await transport.readCount()).toBe(2);
    const pending = transport.readCount();
    await expect(transport.readCount()).rejects.toThrow('READ_BLOCKED');
    await vi.advanceTimersByTimeAsync(799);
    expect(calls.filter(value => typeof value === 'object')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe(2);
    expect(calls.filter(value => typeof value === 'object')).toHaveLength(2);
  } finally { vi.useRealTimers(); }
});
