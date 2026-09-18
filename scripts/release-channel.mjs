import path from 'node:path';
import { fileURLToPath } from 'node:url';

function versionParts(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/.exec(version);
  if (!match) throw new Error('Unsupported release version');
  return { numeric: match.slice(1, 4).map(Number), prerelease: Boolean(match[4]) };
}

export function releaseChannel(version, latestTag = null) {
  const candidate = versionParts(version);
  // Channel calculation is not publication permission; the readiness gate is independent.
  if (candidate.numeric[0] >= 28) throw new Error('FUTURE_SEASON_RELEASE_NOT_ENABLED');
  let newer = true;
  if (latestTag !== null) {
    if (typeof latestTag !== 'string' || !latestTag.startsWith('v')) throw new Error('Invalid latest tag');
    const latest = versionParts(latestTag.slice(1));
    if (latest.prerelease) throw new Error('Latest must be stable');
    newer = false;
    for (let i = 0; i < 3; i++) {
      if (candidate.numeric[i] !== latest.numeric[i]) { newer = candidate.numeric[i] > latest.numeric[i]; break; }
    }
  }
  return { prerelease: candidate.prerelease, latest: !candidate.prerelease && newer };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(releaseChannel(process.argv[2], process.argv[3] || null)));
}
