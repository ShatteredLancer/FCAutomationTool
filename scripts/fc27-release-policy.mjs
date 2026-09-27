const version = value => typeof value === 'string' && /^27\.\d+\.\d+$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Release readiness is evaluated against the exact version being built. The
// old 27.0.0 read-only approval was a one-off delivery record and must not
// gate later versions or newly verified capabilities.
export function isReleaseArtifact(manifest) {
  return version(manifest?.version) && manifest?.targetSeason === '27'
    && manifest.schema === 1 && manifest.name === 'FC Automation Tool'
    && manifest.namespace === 'https://github.com/ShatteredLancer/FCAutomationTool'
    && manifest.releaseScope === 'fc27'
    && typeof manifest.liveExecutionEnabled === 'boolean' && hash(manifest.sha256)
    && Number.isSafeInteger(manifest.bytes) && manifest.bytes > 0 && manifest.releaseEligible === true;
}

export function assertRelease({ manifest, fsu, fsuConfig }) {
  if (!isReleaseArtifact(manifest)) throw new Error('FC27_RELEASE_ARTIFACT_INVALID');
  if (!fsu || typeof fsu.localVersion !== 'string' || !/^\d+(\.\d+)+$/.test(fsu.localVersion)
      || !hash(fsu.modifiedSha256?.toLowerCase()) || fsu.localVersion !== fsuConfig?.localVersion
      || fsu.upstreamVersion !== fsuConfig?.upstreamVersion) {
    throw new Error('FC27_FSU_RELEASE_CONFIG_MISMATCH');
  }
  return { scope: manifest.releaseScope, version: manifest.version,
    liveExecutionEnabled: manifest.liveExecutionEnabled };
}
