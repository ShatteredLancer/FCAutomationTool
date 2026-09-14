import { expect, it } from 'vitest';
import { inspectionOptions } from '../../scripts/browser-inspection/options.mjs';

it('defaults to help without launching a browser', () => {
  expect(inspectionOptions([]).help).toBe(true);
  expect(inspectionOptions(['--help']).help).toBe(true);
});
it('accepts an explicit mode and executable path', () => {
  expect(inspectionOptions(['--interactive', '--browser', 'C:/Program Files/browser.exe']))
    .toMatchObject({ interactive: true, selfTest: false, executable: 'C:/Program Files/browser.exe' });
});
it.each([
  ['--self-test', '--interactive'], ['--self-test', '--self-test'],
  ['--interactive', '--broser', 'chrome'], ['--browser'],
  ['--browser', '--interactive'], ['--browser', 'chrome'],
  ['--interactive', '--browser', 'chrome', '--browser', 'edge'],
])('rejects ambiguous or malformed arguments %j', (...args) => {
  expect(() => inspectionOptions(args)).toThrow();
});
