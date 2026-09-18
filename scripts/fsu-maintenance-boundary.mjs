const normalize = value => String(value).replaceAll('\r\n', '\n').trimEnd();
const renamed = value => normalize(value).replaceAll('ShatteredLancer/DailyLoopRunner', 'ShatteredLancer/FCAutomationTool');

function metadata(source) {
  return normalize(source).match(/^\/\/ ==UserScript==\n[\s\S]*?^\/\/ ==\/UserScript==$/m)?.[0] ?? null;
}

// This authorizes maintained inputs, not releases; the caller must still replay the patch.
export function assertFsuMaintenanceBoundary({ archivedConfig, currentConfig, archivedOrigin, currentOrigin,
  archivedSource, currentSource }) {
  const keys = new Set([...Object.keys(archivedConfig), ...Object.keys(currentConfig)]);
  for (const key of keys) {
    if (key !== 'localVersion' && JSON.stringify(archivedConfig[key]) !== JSON.stringify(currentConfig[key])) {
      throw new Error('FSU_MAINTENANCE_CONFIG_CHANGED');
    }
  }
  if (!Buffer.isBuffer(archivedOrigin) || !Buffer.isBuffer(currentOrigin) || !archivedOrigin.equals(currentOrigin)) {
    throw new Error('FSU_IMMUTABLE_ORIGIN_CHANGED');
  }
  const parse = version => {
    if (typeof version !== 'string') return null;
    const parts = version.split('.');
    if (parts.length !== 3 || parts.slice(0, 2).join('.') !== archivedConfig.upstreamVersion
        || !/^(0|[1-9]\d*)$/.test(parts[2]) || !Number.isSafeInteger(Number(parts[2]))) return null;
    return Number(parts[2]);
  };
  const before = parse(archivedConfig.localVersion);
  const after = parse(currentConfig.localVersion);
  if (before === null || after === null || after < before) throw new Error('FSU_MAINTENANCE_VERSION_INVALID');
  const oldMetadata = metadata(renamed(archivedSource));
  const versionLines = oldMetadata?.match(/^\/\/\s*@version\s+[^\n]+$/gm);
  if (versionLines?.length !== 1) throw new Error('FSU_MAINTENANCE_METADATA_CHANGED');
  const expectedMetadata = oldMetadata.replace(versionLines[0], versionLines[0]
    .replace(archivedConfig.localVersion, currentConfig.localVersion));
  if (metadata(currentSource) !== expectedMetadata) throw new Error('FSU_MAINTENANCE_METADATA_CHANGED');
  if (before === after && renamed(archivedSource) !== normalize(currentSource)) {
    throw new Error('FSU_LOCAL_VERSION_NOT_BUMPED');
  }
  return { mode: before === after ? 'frozen-local' : 'maintained-local',
    upstreamVersion: currentConfig.upstreamVersion, localVersion: currentConfig.localVersion };
}
