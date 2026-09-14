export function projectBaselineVersion(source, archivedVersion, currentVersion) {
  if (![archivedVersion, currentVersion].every(value => /^0\.8\.\d+$/.test(value))) {
    throw new Error('FC26 baseline only permits 0.8.x maintenance versions');
  }
  const fields = [
    [`// @version      ${archivedVersion}`, `// @version      ${currentVersion}`],
    [`    version: "${archivedVersion}",`, `    version: "${currentVersion}",`]
  ];
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  for (const [before, after] of fields) {
    if (lines.filter(line => line === before).length !== 1) {
      throw new Error('Unexpected archived FC26 version field');
    }
    lines[lines.indexOf(before)] = after;
  }
  return lines.join('\n');
}
