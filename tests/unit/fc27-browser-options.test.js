import { expect, it } from 'vitest';
import { inspectionOptions, fsuSetupOptions } from '../../scripts/browser-inspection/options.mjs';

it('keeps setup direct by default and explicitly supports a loopback proxy', () => {
  expect(fsuSetupOptions([])).toEqual({});
  expect(fsuSetupOptions(['--preview'])).toEqual({ preview: true });
  expect(() => fsuSetupOptions(['--preview', '--preview'])).toThrow();
  expect(fsuSetupOptions(['--proxy', '127.0.0.1:1080'])).toEqual({
    proxy: { server: 'http://127.0.0.1:1080', bypass: 'localhost,127.0.0.1,[::1]' },
  });
  expect(fsuSetupOptions(['--proxy', 'socks5://127.0.0.1:1080']).proxy.server)
    .toBe('socks5://127.0.0.1:1080');
});

it.each([
  ['--proxy'], ['--proxy', '127.0.0.1:1080', '--proxy', '127.0.0.1:1081'],
  ['--unknown'], ['--proxy', 'http://user:pass@127.0.0.1:1080'],
  ['--proxy', 'http://example.com:1080'], ['--proxy', 'http://127.0.0.1:1080/path'],
  ['--proxy', 'http://127.0.0.1:1080/?secret=x'], ['--proxy', 'http://127.0.0.1:1080/#x'],
  ['--proxy', 'file://127.0.0.1:1080'], ['--proxy', '127.0.0.1:0'],
])('rejects malformed or nonlocal setup proxy %j', (...args) => {
  expect(() => fsuSetupOptions(args)).toThrow();
});

it('defaults to help without launching a browser', () => {
  expect(inspectionOptions([]).help).toBe(true);
  expect(inspectionOptions(['--help']).help).toBe(true);
});
it('accepts an explicit mode and executable path', () => {
  expect(inspectionOptions(['--interactive', '--browser', 'C:/Program Files/browser.exe']))
    .toMatchObject({ interactive: true, selfTest: false, executable: 'C:/Program Files/browser.exe' });
});
it('accepts bounded automatic collection, with extensions only when explicitly requested', () => {
  expect(inspectionOptions(['--auto'])).toMatchObject({ auto: true, durationSeconds: 120, withExtensions: false });
  expect(inspectionOptions(['--auto', '--duration-seconds', '300', '--with-extensions']))
    .toMatchObject({ auto: true, durationSeconds: 300, withExtensions: true });
});
it('supports one persistent agent-controlled native session', () => {
  expect(inspectionOptions(['--agent'])).toMatchObject({ agent: true, withExtensions: false });
  expect(() => inspectionOptions(['--agent', '--duration-seconds', '30'])).toThrow();
});
it.each([
  ['--self-test', '--interactive'], ['--self-test', '--self-test'],
  ['--interactive', '--broser', 'chrome'], ['--browser'],
  ['--browser', '--interactive'], ['--browser', 'chrome'],
  ['--interactive', '--browser', 'chrome', '--browser', 'edge'],
  ['--auto', '--interactive'], ['--auto', '--duration-seconds', '0'],
  ['--auto', '--duration-seconds', '601'], ['--auto', '--duration-seconds', 'Infinity'],
  ['--auto', '--duration-seconds', '1.5'], ['--self-test', '--with-extensions'],
  ['--interactive', '--duration-seconds', '30'], ['--auto', '--with-extensions', '--with-extensions'],
])('rejects ambiguous or malformed arguments %j', (...args) => {
  expect(() => inspectionOptions(args)).toThrow();
});
