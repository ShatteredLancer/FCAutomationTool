import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../FSU_mod/【FSU】EAFC FUT WEB 增强器-26.09_mod.user.js', import.meta.url), 'utf8');
const observed = JSON.parse(readFileSync(new URL('../fixtures/fc27-fsu-startup-race-observation.json', import.meta.url), 'utf8'));
function section(start, end) {
  const offset = source.indexOf(start);
  const limit = source.indexOf(end, offset);
  if (offset < 0 || limit < 0) throw new Error(`Missing FSU section: ${start}`);
  return source.slice(offset, limit);
}

function harness() {
  const root = {};
  const app = { _rootViewController: root };
  const info = { base: { initialized: false, state: false, clubCache: { status: 'trusted-provisional' } } };
  const listeners = new Map();
  const events = { init: vi.fn().mockResolvedValue(true),
    createTile: () => ({ __root: { after() {} } }), reloadPlayers: vi.fn() };
  const shield = { showing: false, isShowing() { return this.showing; } };
  function HomeView() { this.__root = { isConnected: true }; this._sbcTile = { __root: { after() {} } }; }
  const view = new HomeView();
  const parent = { navigationBar: {}, getView: () => ({}) };
  const home = { className: 'UTHomeHubViewController', parentViewController: parent, getView: () => view };
  let current = home;
  const warnings = vi.fn();
  const context = vm.createContext({ info, events, cntlr: { current: () => current }, gClickShield: shield,
    _appMain: app, UTHomeHubView: HomeView, setInterval, clearInterval, Date,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
    call: { task: { home() { this._generated = true; } } },
    console: { log() {}, warn: warnings }, GM_addStyle() {}, fy: value => value });
  vm.runInContext(section('        events.waitForClickShieldToHide = ', '        // 25.22 移除进化重复图标问题'), context);
  const start = source.includes('        events.scheduleHomeInitialization = ')
    ? '        events.scheduleHomeInitialization = ' : '        UTHomeHubView.prototype._generate = ';
  vm.runInContext(section(start, '        events.reloadPlayers = '), context);
  return { info, events, view, home, parent, shield, warnings, listeners, context,
    setCurrent(value) { current = value; }, generate: () => view._generate() };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('original FSU Home initialization readiness', () => {
  it('replays the real controller-late trace and initializes once when it becomes ready', async () => {
    const value = harness();
    const trace = observed.failedReload;
    const generatedAt = trace.samples.find(sample => sample.homeTiles).elapsedMs;
    const readyAt = trace.samples.find(sample => sample.currentPresent).elapsedMs;
    vi.setSystemTime(generatedAt);
    value.setCurrent(null);
    value.generate();
    await vi.advanceTimersByTimeAsync(trace.warning.elapsedMs - generatedAt);
    expect(value.events.init).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(readyAt - trace.warning.elapsedMs);
    value.setCurrent(value.home);
    await vi.advanceTimersByTimeAsync(100);
    expect(value.events.init).toHaveBeenCalledOnce();
    expect(value.info.base.state).toBe(false);
    expect(value.info.base.clubCache.status).toBe('trusted-provisional');
    expect(value.events.reloadPlayers).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(value.listeners.size).toBe(0);
  });

  it('waits for a shield lasting longer than the shared five-second helper without changing it', async () => {
    const value = harness(); value.shield.showing = true;
    value.generate();
    await vi.advanceTimersByTimeAsync(6000);
    expect(value.events.init).not.toHaveBeenCalled();
    value.shield.showing = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(value.events.init).toHaveBeenCalledOnce();
    value.shield.showing = true;
    const manual = vi.fn(); value.events.waitForClickShieldToHide(manual);
    await vi.advanceTimersByTimeAsync(6000);
    value.shield.showing = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(manual).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('deduplicates repeated generate calls and waits for the parent view dependency', async () => {
    const value = harness(); value.home.parentViewController = null;
    value.generate(); value.generate(); value.generate();
    await vi.advanceTimersByTimeAsync(500);
    expect(value.events.init).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    value.home.parentViewController = value.parent;
    await vi.advanceTimersByTimeAsync(100);
    expect(value.events.init).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(value.events.init).toHaveBeenCalledOnce();
  });

  it.each(['initialized', 'initPromise'])('does not restart an initialization already %s', async key => {
    const value = harness(); value.info.base[key] = key === 'initialized' ? true : Promise.resolve(true);
    value.generate();
    await vi.advanceTimersByTimeAsync(100);
    expect(value.events.init).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out once and does not accept a controller arriving after the deadline', async () => {
    const value = harness(); value.setCurrent(null); value.generate();
    await vi.advanceTimersByTimeAsync(30000);
    expect(value.warnings).toHaveBeenCalledWith('[FSU init] home startup readiness timed out');
    expect(value.warnings).toHaveBeenCalledTimes(1);
    value.setCurrent(value.home);
    await vi.advanceTimersByTimeAsync(1000);
    expect(value.events.init).not.toHaveBeenCalled();
    expect(value.info.base.homeInitWait).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(value.listeners.size).toBe(0);
  });

  it.each(['pagehide', 'root-replaced', 'app-replaced', 'view-detached', 'different-controller', 'different-view'])(
    'cancels a pending startup on %s', async kind => {
      const value = harness(); value.setCurrent(null); value.generate();
      await vi.advanceTimersByTimeAsync(100);
      if (kind === 'pagehide') value.listeners.get('pagehide')?.();
      if (kind === 'root-replaced') value.context._appMain._rootViewController = {};
      if (kind === 'app-replaced') value.context._appMain = {};
      if (kind === 'view-detached') value.view.__root.isConnected = false;
      if (kind === 'different-controller') value.setCurrent({ className: 'UTLoginViewController' });
      if (kind === 'different-view') value.setCurrent({ ...value.home, getView: () => ({}) });
      await vi.advanceTimersByTimeAsync(100);
      value.setCurrent(value.home);
      await vi.advanceTimersByTimeAsync(100);
      expect(value.events.init).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(value.listeners.size).toBe(0);
    },
  );

  it('allows a not-yet-attached Home to mount before starting init', async () => {
    const value = harness(); value.view.__root.isConnected = false;
    value.generate();
    await vi.advanceTimersByTimeAsync(100);
    expect(value.events.init).not.toHaveBeenCalled();
    value.view.__root.isConnected = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(value.events.init).toHaveBeenCalledOnce();
  });

  it('keeps waiting through a transient controller getter error', async () => {
    const value = harness();
    const readView = value.home.getView;
    value.home.getView = () => { throw new Error('navigation not ready'); };
    value.generate();
    await vi.advanceTimersByTimeAsync(500);
    expect(value.events.init).not.toHaveBeenCalled();
    value.home.getView = readView;
    await vi.advanceTimersByTimeAsync(100);
    expect(value.events.init).toHaveBeenCalledOnce();
  });

  it('cancels its wait if another existing caller has started init', async () => {
    const value = harness(); value.setCurrent(null); value.generate();
    value.info.base.initPromise = Promise.resolve(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(value.events.init).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(value.listeners.size).toBe(0);
  });

  it('replaces an obsolete Home wait without retaining its timer or pagehide listener', async () => {
    const value = harness(); value.setCurrent(null); value.generate();
    const nextView = new value.view.constructor();
    nextView._generate();
    expect(vi.getTimerCount()).toBe(1);
    expect(value.listeners.size).toBe(1);
    value.setCurrent({ ...value.home, getView: () => nextView });
    await vi.advanceTimersByTimeAsync(100);
    expect(value.events.init).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('checks the wall-clock deadline before using readiness after a delayed timer tick', async () => {
    const value = harness(); value.setCurrent(null); value.generate();
    vi.setSystemTime(40000);
    value.setCurrent(value.home);
    await vi.advanceTimersByTimeAsync(100);
    expect(value.events.init).not.toHaveBeenCalled();
    expect(value.warnings).toHaveBeenCalledWith('[FSU init] home startup readiness timed out');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['throw', 'reject', 'false'])('never automatically retries an initialization that returns %s', async kind => {
    const value = harness();
    if (kind === 'throw') value.events.init.mockImplementation(() => { throw new Error('private detail'); });
    if (kind === 'reject') value.events.init.mockRejectedValue(new Error('private detail'));
    if (kind === 'false') value.events.init.mockResolvedValue(false);
    value.generate();
    await vi.advanceTimersByTimeAsync(30000);
    expect(value.events.init).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.stringify(value.warnings.mock.calls)).not.toContain('private detail');
  });
});
