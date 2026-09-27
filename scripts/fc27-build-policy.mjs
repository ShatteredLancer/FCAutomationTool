// Production grows through normal source imports. The dependency graph remains
// visible in the manifest, without a frozen list of individually approved files.
// Node inspection tools, fixtures and vendored FSU bundles are not browser source.
export function assertFc27BrowserInputs(inputs) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.some(name => typeof name !== 'string'
      || !name.startsWith('src/') || name.includes('..') || !name.endsWith('.js')
      || name === 'src/userscript-entry.js')) throw new Error('FC27_BROWSER_DEPENDENCY_INVALID');
}

// Network access is declared explicitly; adding a feature no longer requires
// defeating a blanket ban on @connect. Broad or insecure permissions still fail.
export function assertFc27ProductionMetadata(metadata) {
  const connects = [...metadata.matchAll(/^\/\/ @connect\s+(.+)$/gm)].map(match => match[1].trim());
  if (connects.some(host => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host)
      || /(^|\.)(localhost|local|invalid)$/i.test(host)) || new Set(connects).size !== connects.length) {
    throw new Error('FC27_NETWORK_PERMISSION_INVALID');
  }
  const grants = [...metadata.matchAll(/^\/\/ @grant\s+(.+)$/gm)].map(match => match[1].trim());
  if (connects.length && !grants.includes('GM_xmlhttpRequest')) throw new Error('FC27_NETWORK_GRANT_MISSING');
}
