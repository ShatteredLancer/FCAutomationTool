import { expect, it } from 'vitest';
import { assertFsuMaintenanceBoundary } from '../../scripts/fsu-maintenance-boundary.mjs';

function fixture() {
  const config = { schema: 1, upstreamVersion: '26.09', localVersion: '26.09.6',
    originFile: 'origin.user.js', modifiedFile: 'mod.user.js', patchFile: 'mod.patch',
    upstreamSource: 'https://update.greasyfork.org/origin.user.js' };
  const metadata = '// ==UserScript==\n// @name FSU\n// @namespace https://futcd.com/\n'
    + '// @version 26.09.6\n// @downloadURL https://github.com/ShatteredLancer/DailyLoopRunner/FSU-Local.user.js\n'
    + '// ==/UserScript==\n';
  const archivedSource = `${metadata}const baseline = true;\n`;
  const currentSource = archivedSource.replaceAll('ShatteredLancer/DailyLoopRunner', 'ShatteredLancer/FCAutomationTool');
  return { archivedConfig: config, currentConfig: { ...config },
    archivedOrigin: Buffer.from('immutable upstream\r\n'), currentOrigin: Buffer.from('immutable upstream\r\n'),
    archivedSource, currentSource };
}

it('keeps the same Local version frozen apart from the approved repository rename', () => {
  const input = fixture();
  expect(assertFsuMaintenanceBoundary(input).mode).toBe('frozen-local');
  input.currentSource += 'changed();';
  expect(() => assertFsuMaintenanceBoundary(input)).toThrow('FSU_LOCAL_VERSION_NOT_BUMPED');
});

it('permits a bumped Local implementation while keeping metadata and upstream identity fixed', () => {
  const input = fixture();
  input.currentConfig.localVersion = '26.09.7';
  input.currentSource = input.currentSource.replace('26.09.6', '26.09.7').replace('baseline = true', 'maintained = true');
  expect(assertFsuMaintenanceBoundary(input)).toMatchObject({ mode: 'maintained-local', localVersion: '26.09.7' });
});

it('requires byte-identical upstream even when the local manifest could be regenerated', () => {
  const input = fixture();
  input.currentOrigin = Buffer.from('immutable upstream\n');
  expect(() => assertFsuMaintenanceBoundary(input)).toThrow('FSU_IMMUTABLE_ORIGIN_CHANGED');
});

it.each(['schema', 'upstreamVersion', 'originFile', 'modifiedFile', 'patchFile', 'upstreamSource'])
('rejects an unrelated config change to %s', key => {
  const input = fixture();
  input.currentConfig[key] = 'changed';
  expect(() => assertFsuMaintenanceBoundary(input)).toThrow('FSU_MAINTENANCE_CONFIG_CHANGED');
});

it.each(['26.09.5', '27.0.0', '26.09.7\ninjected', '26.09.07', '26.09.7.1'])
('rejects downgrade or unreviewed version %s', version => {
  const input = fixture();
  input.currentConfig.localVersion = version;
  expect(() => assertFsuMaintenanceBoundary(input)).toThrow('FSU_MAINTENANCE_VERSION_INVALID');
});

it('rejects identity, permissions and version drift in maintained metadata', () => {
  for (const change of [source => source.replace('@name FSU', '@name Replacement'),
    source => source.replace('// ==/UserScript==', '// @connect unreviewed.example\n// ==/UserScript=='),
    source => source.replace('@version 26.09.7', '@version 26.09.8')]) {
    const input = fixture();
    input.currentConfig.localVersion = '26.09.7';
    input.currentSource = change(input.currentSource.replace('26.09.6', '26.09.7'));
    expect(() => assertFsuMaintenanceBoundary(input)).toThrow('FSU_MAINTENANCE_METADATA_CHANGED');
  }
});
