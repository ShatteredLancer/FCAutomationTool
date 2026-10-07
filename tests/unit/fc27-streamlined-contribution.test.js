import { expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { createFc27StreamlinedContributionTransport, FC27_STREAMLINED_CONTRIBUTION_METHODS } from '../../src/adapters/ea/fc27-streamlined-contribution.js';

function runtime({ prototype = false } = {}) {
  const f = executionRuntime(), { root, calls } = f;
  const dao = root.services.SBC.sbcDAO;
  dao.submitPlayers = function () { throw Error('queued submission must not be called'); };
  dao.initiateOneClickChallenge = function () { throw Error('queued initiation must not be called'); };
  if (prototype) {
    Object.setPrototypeOf(dao, { submitPlayers: dao.submitPlayers, initiateOneClickChallenge: dao.initiateOneClickChallenge });
    delete dao.submitPlayers; delete dao.initiateOneClickChallenge;
  }
  const nativeHashes = new Map(FC27_STREAMLINED_CONTRIBUTION_METHODS.map(([path, hash]) =>
    [String(dao[path.split('.').at(-1)]).replaceAll('\r\n', '\n'), hash]));
  const requestSend = root.UTHttpRequest.prototype.send;
  const sendSource = String(requestSend).replaceAll('\r\n', '\n');
  root.UTHttpRequest.prototype.send = function () {
    if (!this.url.includes('/sbs/challenge/')) return requestSend.call(this);
    calls.push({ kind: 'oneclick', method: this.requestType, url: this.url, body: this.requestBody,
      retry: this.doRetry, reauth: this.doReauth });
    if (f.state.timeout) return;
    this.callback(f.state.wrongOwner ? {} : this, { success: true, status: 200, response: {
      challengeId: 85, setId: 48, submittedScore: 40, grantedSetAwards: [], grantedChallengeAwards: [],
    } });
  };
  const wrappedSource = String(root.UTHttpRequest.prototype.send).replaceAll('\r\n', '\n');
  const originalDigest = root.crypto.subtle.digest.getMockImplementation();
  root.crypto.subtle.digest.mockImplementation(async (algorithm, bytes) => {
    const source = new TextDecoder().decode(bytes).replaceAll('\r\n', '\n');
    const hash = nativeHashes.get(source);
    return hash ? Uint8Array.from(Buffer.from(hash, 'hex')).buffer
      : originalDigest(algorithm, new TextEncoder().encode(source === wrappedSource ? sendSource : source));
  });
  return f;
}
const target = { challengeId: 85, itemIds: [1, 2] };
it('matches native initiation and contribution endpoints, persists before send and disables retries', async () => {
  const f = runtime(), transport = await createFc27StreamlinedContributionTransport(f.root, { canWrite: () => true });
  await transport.request('initiate', target, () => f.calls.push({ kind: 'journal' }));
  await transport.request('contribute', target, () => f.calls.push({ kind: 'journal' }));
  expect(f.calls.map(row => row.kind)).toEqual(['journal', 'oneclick', 'journal', 'oneclick']);
  expect(f.calls[1]).toMatchObject({ method: 'POST', url: 'https://utas.test.ea.com/ut/game/fc27/sbs/challenge/85', body: undefined });
  expect(f.calls[3]).toMatchObject({ method: 'POST', url: 'https://utas.test.ea.com/ut/game/fc27/sbs/challenge/85/item/submit',
    body: { playerItemIds: [1, 2], skipUserSquadValidation: true }, retry: false, reauth: false });
});
it('is disabled by default and rejects duplicate identities, missing write-ahead callback and failed persistence', async () => {
  const f = runtime();
  const disabled = await createFc27StreamlinedContributionTransport(f.root);
  await expect(disabled.request('contribute', target, () => {})).rejects.toThrow('WRITE_CONTRACT');
  const transport = await createFc27StreamlinedContributionTransport(f.root, { canWrite: () => true });
  await expect(transport.request('contribute', { ...target, itemIds: [1, 1] }, () => {})).rejects.toThrow('INPUT_INVALID');
  await expect(transport.request('contribute', target)).rejects.toThrow('WRITE_CONTRACT');
  await expect(transport.request('contribute', target, () => { throw Error('disk'); })).rejects.toThrow('disk');
  expect(f.calls).toEqual([]);
});
it('rechecks account and authorization after asynchronous write-ahead persistence', async () => {
  for (const accountChange of [true, false]) {
    const f = runtime(); let allowed = true;
    const transport = await createFc27StreamlinedContributionTransport(f.root, { canWrite: () => allowed });
    await expect(transport.request('contribute', target, async () => {
      if (accountChange) f.user.selectedPersona = 123; else allowed = false;
    })).rejects.toThrow();
    expect(f.calls).toEqual([]);
  }
});
it('does not retry a missing receipt and ignores late callbacks after timeout', async () => {
  vi.useFakeTimers();
  try {
    const f = runtime(); f.state.timeout = true;
    const transport = await createFc27StreamlinedContributionTransport(f.root, { canWrite: () => true });
    const pending = transport.request('contribute', target, () => {}).catch(error => error.message);
    await vi.advanceTimersByTimeAsync(11001);
    expect(await pending).toContain('CONTRIBUTION_UNCONFIRMED');
    await expect(transport.request('contribute', target, () => {})).rejects.toThrow('TRANSPORT_BLOCKED');
    expect(f.calls.filter(row => row.kind === 'oneclick')).toHaveLength(1);
    expect(f.calls.filter(row => row.kind === 'abort')).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});
it('rejects method replacement and mismatched response ownership', async () => {
  for (const replace of [false, true]) {
    const f = runtime(), transport = await createFc27StreamlinedContributionTransport(f.root, { canWrite: () => true });
    if (replace) f.root.services.SBC.sbcDAO.submitPlayers = () => {};
    else f.state.wrongOwner = true;
    await expect(transport.request('contribute', target, () => {})).rejects.toThrow();
    expect(f.calls.filter(row => row.kind === 'oneclick')).toHaveLength(replace ? 0 : 1);
  }
});

it('verifies real prototype methods and rejects subsequent own overrides or prototype replacements', async () => {
  for (const change of ['none', 'own', 'prototype', 'accessor']) {
    const f = runtime({ prototype: true });
    const transport = await createFc27StreamlinedContributionTransport(f.root, { canWrite: () => true });
    const dao = f.root.services.SBC.sbcDAO;
    const getter = vi.fn(() => Object.getPrototypeOf(dao).submitPlayers);
    if (change === 'own') dao.submitPlayers = () => {};
    if (change === 'prototype') Object.getPrototypeOf(dao).submitPlayers = () => {};
    if (change === 'accessor') Object.defineProperty(dao, 'submitPlayers', { get: getter });
    const request = transport.request('contribute', target, () => {});
    if (change === 'none') await expect(request).resolves.toMatchObject({ success: true });
    else await expect(request).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(f.calls.filter(row => row.kind === 'oneclick')).toHaveLength(change === 'none' ? 1 : 0);
  }
});

it('rejects malformed identities without invoking user-provided slice', async () => {
  const f = runtime(), transport = await createFc27StreamlinedContributionTransport(f.root, { canWrite: () => true });
  const slice = vi.fn(() => [1, 2]);
  for (const itemIds of [undefined, 2, '12', { slice }]) {
    await expect(transport.request('contribute', { ...target, itemIds }, () => {})).rejects.toThrow('INPUT_INVALID');
  }
  expect(slice).not.toHaveBeenCalled(); expect(f.calls).toEqual([]);
});
