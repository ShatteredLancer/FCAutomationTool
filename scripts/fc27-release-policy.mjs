export function isApprovedReadonlyArtifact(manifest, approval) {
  return approval?.schema === 1 && approval.approved === true && approval.scope === 'read-only'
    && approval.liveExecutionEnabled === false && approval.liveAcceptanceVerified === false
    && manifest?.releaseScope === 'read-only' && manifest.liveExecutionEnabled === false
    && manifest.targetSeason === '27' && manifest.version === approval.version
    && /^[a-f0-9]{64}$/.test(manifest.sha256) && manifest.sha256 === approval.sha256;
}

export function assertReadonlyRelease({ manifest, approval, evidence, fsu }) {
  if (!isApprovedReadonlyArtifact(manifest, approval)) throw new Error('FC27_READONLY_RELEASE_NOT_APPROVED');
  if (evidence?.version !== manifest.version || evidence.sha256 !== manifest.sha256
      || evidence.name !== manifest.name || evidence.namespace !== manifest.namespace
      || evidence.installed !== true || evidence.gmReloadVerified !== true || evidence.separateFromAcceptance !== true
      || evidence.exactInstallerSourceVerified !== true || evidence.installedSourceVerifiedAfterBrowserRestart !== true
      || evidence.gmPreservedAfterUpdateAndBrowserRestart !== true || evidence.update?.updated !== true
      || evidence.update?.finalSourceMatches !== true || evidence.update?.finalGithubMetadataRestored !== true
      || !(evidence.update?.metadataRequests >= 1) || !(evidence.update?.fullScriptRequests >= 1)
      || evidence.liveEnabled !== false) throw new Error('FC27_INSTALLATION_EVIDENCE_PENDING');
  if (fsu?.localVersion !== approval.fsuLocalVersion || fsu.modifiedSha256?.toLowerCase() !== approval.fsuSha256) {
    throw new Error('FC27_FSU_RELEASE_NOT_APPROVED');
  }
  return { scope: 'read-only', version: manifest.version, liveExecutionEnabled: false, liveAcceptanceVerified: false };
}
