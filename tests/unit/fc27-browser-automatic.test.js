import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { collectAutomatically, WEB_APP_URL } from '../../scripts/browser-inspection/automatic.mjs';

function setup(pages = [{ url: () => WEB_APP_URL }]) {
  let elapsed = 0;
  const context = new EventEmitter();
  context.pages = () => pages;
  return { context, durationSeconds: 9, network: { snapshot: () => ({ total: 7 }) },
    save: vi.fn(), now: () => elapsed, wait: async ms => { elapsed += ms; },
    environment: vi.fn(async () => ({ season: '27', liveExecutionEnabled: false })),
    runtime: vi.fn(async () => ({ evidence: 'passive-data-descriptors' })), ui: async () => null };
}
it('captures without terminal input and persists final bounded results', async () => {
  const args = setup();
  const result = await collectAutomatically(args);
  expect(result).toMatchObject({ status: 'window-ended', observations: 3, liveExecutionEnabled: false, network: { total: 7 } });
  expect(result.samples).toHaveLength(1);
  expect(args.save).toHaveBeenCalledTimes(4);
  expect(args.save).toHaveBeenLastCalledWith(result);
  expect(args.context.listenerCount('close')).toBe(0);
});
it('does not inspect auth pages or choose between multiple game tabs', async () => {
  const auth = setup([{ url: () => 'https://accounts.ea.com/login?secret=private' }]);
  expect((await collectAutomatically(auth)).last.state).toBe('WEB_APP_TAB_UNAVAILABLE');
  expect(auth.environment).not.toHaveBeenCalled();
  const many = setup([{ url: () => WEB_APP_URL }, { url: () => WEB_APP_URL }]);
  expect((await collectAutomatically(many)).last.state).toBe('AMBIGUOUS_WEB_APP_TABS');
  expect(many.environment).not.toHaveBeenCalled();
});
it('redacts evaluation errors and stops on browser close', async () => {
  const args = setup();
  args.runtime = vi.fn(async () => { throw new Error('private-token'); });
  args.wait = async () => args.context.emit('close');
  const result = await collectAutomatically(args);
  expect(result.status).toBe('browser-closed');
  expect(result.last.state).toBe('OBSERVATION_UNAVAILABLE');
  expect(JSON.stringify(result)).not.toContain('private-token');
});
it('retains only twenty changed samples, even over the maximum window', async () => {
  const args = setup();
  args.durationSeconds = 600;
  let count = 0;
  args.runtime = async () => ({ count: count++ });
  const result = await collectAutomatically(args);
  expect(result.samples).toHaveLength(20);
  expect(result.observations).toBe(200);
});
it('cleans up its listener if local persistence fails', async () => {
  const args = setup();
  args.save = async () => { throw new Error('disk unavailable'); };
  await expect(collectAutomatically(args)).rejects.toThrow('disk unavailable');
  expect(args.context.listenerCount('close')).toBe(0);
});
it('requests native SBC navigation only once, only for season 27 with extensions disabled', async () => {
  const args = setup();
  args.extensionsDisabled = true;
  args.ui = async () => ({ home: true, sbcTab: true, modal: false });
  args.navigate = vi.fn(async () => 'SBC_TAB_REQUESTED');
  await collectAutomatically(args);
  expect(args.navigate).toHaveBeenCalledOnce();
  args.navigate.mockClear();
  args.environment = async () => ({ season: '26' });
  await collectAutomatically(args);
  expect(args.navigate).not.toHaveBeenCalled();
});
