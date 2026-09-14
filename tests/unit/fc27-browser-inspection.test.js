import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createNetworkSummary, pageKind } from '../../scripts/browser-inspection/probe.mjs';

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
});
