import { expect, it, vi } from 'vitest';
import { normalizeClubForPreview, prepareTraditionalPreview } from '../../FSU_mod/src/enhancements/traditional-fill.js';

const context = { schema: 1, season: '27', accountScope: 'test', platform: 'pc:test' };
const policy = { onlyUntradeable: true, excludeEvolution: true, protectFsuLockedPlayers: true,
  protectActiveSquad: false, storageFirst: true, maxRating: 74, goldRange: [75, 82], excludedLeagueIds: [] };
const item = id => ({ id, definitionId: id + 10, type: 'player', pile: 'club', rating: 65,
  special: false, evolution: false, cosmetic: false, concept: false, academyEnrolled: false,
  activeTrade: false, limitedUse: false, loans: -1, tradeable: false, leagueId: 1,
  protected: null, locked: null, activeSquad: null, safetyFingerprint: 'test-only' });
const snapshot = { schema: 1, kind: 'fresh-club-inspection', context, status: 'provisional', complete: true, items: [item(1), item(2)] };
const challenge = { schema: 1, context, mechanism: 'traditional', requirementsOperation: 'AND', setId: 1, id: 2,
  completed: false, slotCount: 2, brickIndices: [], requirements: [{ kind: 'player-count', count: 2 }] };
function fixture() {
  const bridge = { getPolicy: () => policy, getLocks: () => ({ itemIds: [], definitionIds: [] }),
    refreshClub: vi.fn(async () => {}), validateClubPlayers: vi.fn(async () => ({ status: 'validated' })) };
  return { bridge, readContext: () => context, getSnapshot: () => snapshot, readChallenge: vi.fn(async () => challenge) };
}
it('normalizes only complete fresh inventory and exact scoped locks, retaining unknown active squad', () => {
  const normalized = normalizeClubForPreview({ context, snapshot, locks: { itemIds: [1], definitionIds: [] }, protectedItemIds: [2] });
  expect(normalized.items[0]).toMatchObject({ locked: true, protected: false, activeSquad: null });
  expect(normalized.items[1].protected).toBe(true);
  expect(() => normalizeClubForPreview({ context, snapshot: { ...snapshot, complete: false }, locks: {} })).toThrow();
});
it('previews and exact-revalidates without any fill, save or submit callback', async () => {
  const options = fixture();
  const result = await prepareTraditionalPreview(options);
  expect(result).toMatchObject({ status: 'preview', exactValidation: true, liveExecutionEnabled: false });
  expect(result.selected).toHaveLength(2);
  expect(options.bridge.validateClubPlayers).toHaveBeenCalledWith(snapshot.items);
});
it('rejects policy changes and does not claim active squad safety when protection is enabled', async () => {
  const options = fixture();
  options.bridge.getPolicy = () => ({ ...policy, protectActiveSquad: true });
  expect((await prepareTraditionalPreview(options)).reason).toBe('FSU_ACTIVE_SQUAD_UNVERIFIED');
  expect(options.bridge.validateClubPlayers).not.toHaveBeenCalled();
  options.bridge.getPolicy = vi.fn().mockReturnValueOnce(policy).mockReturnValue({ ...policy, maxRating: 60 });
  expect((await prepareTraditionalPreview(options)).reason).toBe('FSU_PREVIEW_CONTEXT_CHANGED');
});
