import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createNetworkCollector, createNetworkSummary, pageKind } from '../../scripts/browser-inspection/probe.mjs';

describe('bounded browser inspection', () => {
  it.each(['http://www.ea.com/ea-sports-fc/ultimate-team/web-app/',
    'https://www.ea.com.evil.test/ea-sports-fc/ultimate-team/web-app/', 'https://accounts.ea.com/login'])('rejects target %s', url => {
    expect(pageKind(url)).toBe('unsupported');
  });
  it('accepts only the Web App path and does not export URLs, headers or body', () => {
    const page = new EventEmitter();
    page.url = () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
    const summary = createNetworkSummary(page);
    const headers = vi.fn(() => { throw new Error('must not inspect'); });
    const response = { url: () => 'https://utas.mob.v5.ea.com/secret?token=private', status: () => 429, headers };
    for (let i = 0; i < 250; i++) page.emit('response', response);
    expect(summary.snapshot()).toMatchObject({ total: 200, capped: true, rateLimited: 200 });
    expect(JSON.stringify(summary.snapshot())).not.toMatch(/token|private|secret/);
    expect(headers).not.toHaveBeenCalled();
    summary.stop();
    expect(page.listenerCount('response')).toBe(0);
  });
  it('keeps a bounded collector alive across navigation and newly opened tabs', () => {
    const first = new EventEmitter();
    first.url = () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
    const second = new EventEmitter();
    second.url = () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
    const pages = [first];
    const context = new EventEmitter();
    context.pages = () => pages;
    const collector = createNetworkCollector(context);
    const response = { url: () => 'https://eafc27.content.easports.com/ut/game/fc27/sbc', status: () => 200 };
    first.emit('response', response);
    pages.push(second);
    context.emit('page', second);
    second.emit('response', response);
    expect(collector.snapshot()).toMatchObject({ total: 2, success: 2, capped: false });
    collector.stop();
    expect(first.listenerCount('response')).toBe(0);
    expect(second.listenerCount('response')).toBe(0);
    expect(second.listenerCount('requestfailed')).toBe(0);
    second.emit('response', response);
    expect(collector.snapshot()).toMatchObject({ total: 2, success: 2 });
  });
  it('enforces the 200-response budget across pages', () => {
    const first = new EventEmitter();
    first.url = () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
    const second = new EventEmitter();
    second.url = () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
    const pages = [first, second];
    const context = new EventEmitter();
    context.pages = () => pages;
    const collector = createNetworkCollector(context);
    const response = { url: () => 'https://utas.mob.v5.ea.com/ut/game/fc27/sbc', status: () => 204 };
    for (let i = 0; i < 150; i++) first.emit('response', response);
    for (let i = 0; i < 150; i++) second.emit('response', response);
    expect(collector.snapshot()).toMatchObject({ total: 200, success: 200, capped: true });
    collector.stop();
  });
  it('counts failed requests on official easports hosts without exporting failure details', () => {
    const page = new EventEmitter();
    page.url = () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
    const summary = createNetworkSummary(page);
    page.emit('requestfailed', { url: () => 'https://eafc27.content.easports.com/assets/app.js', failure: () => ({ errorText: 'private' }) });
    expect(summary.snapshot()).toMatchObject({ total: 1, failed: 1 });
    expect(JSON.stringify(summary.snapshot())).not.toContain('private');
    summary.stop();
    expect(page.listenerCount('requestfailed')).toBe(0);
  });
});
