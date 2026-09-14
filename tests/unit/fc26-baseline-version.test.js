import { describe, expect, it } from 'vitest';
import { projectBaselineVersion } from '../../scripts/fc26-baseline-version.mjs';

const baseline = '// @version      0.8.64\n    version: "0.8.64",\nconst behavior = "0.8.64";\n';

describe('FC26 frozen artifact maintenance version', () => {
  it('changes only the two exact version fields and normalizes CRLF', () => {
    expect(projectBaselineVersion(baseline.replaceAll('\n', '\r\n'), '0.8.64', '0.8.65'))
      .toBe('// @version      0.8.65\n    version: "0.8.65",\nconst behavior = "0.8.64";\n');
  });
  it('preserves all other content so behavior changes fail comparison', () => {
    const expected = projectBaselineVersion(baseline, '0.8.64', '0.8.65');
    expect(expected).not.toBe(expected.replace('behavior', 'changedBehavior'));
    expect(expected).not.toBe(expected.replace('const behavior = "0.8.64"', 'const behavior = "0.8.65"'));
  });
  it('rejects missing or repeated archived fields', () => {
    expect(() => projectBaselineVersion('', '0.8.64', '0.8.65')).toThrow();
    expect(() => projectBaselineVersion(baseline + baseline, '0.8.64', '0.8.65')).toThrow();
  });
  it('does not authorize FC27 or malformed versions', () => {
    for (const version of ['27.0.0', '0.9.0', '0.8.65\ninjected']) {
      expect(() => projectBaselineVersion(baseline, '0.8.64', version)).toThrow();
    }
  });
});
