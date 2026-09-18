const KEY = 'fsu_fc27_preview_installation_v1';
const FSU_NAME = '\u3010FSU\u3011EAFC FUT WEB \u589e\u5f3a\u5668';
const versionValid = value => typeof value === 'string' && /^\d+(?:\.\d+){1,5}$/.test(value) && value.length <= 40;
const bootValid = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

export function checkFsuInstallation({ get, set, info, version, bootId }) {
  const result = { schema: 1, manager: null, managerVersion: null, scriptVersion: null,
    gmWriteRead: false, previousLoad: false, reason: 'FSU_INSTALLATION_UNVERIFIED' };
  try {
    if (info?.scriptHandler !== 'Tampermonkey' || info?.script?.name !== FSU_NAME
        || info?.script?.namespace !== 'https://futcd.com/' || info?.script?.version !== version
        || !versionValid(version) || !versionValid(info?.version) || !bootValid(bootId)
        || typeof get !== 'function' || typeof set !== 'function') return Object.freeze(result);
    Object.assign(result, { manager: 'Tampermonkey', managerVersion: info.version, scriptVersion: version });
    const previous = get(KEY, null);
    if (previous !== null && (previous?.schema !== 1 || !versionValid(previous.version) || !bootValid(previous.bootId)
        || Object.keys(previous).sort().join(',') !== 'bootId,schema,version')) {
      return Object.freeze({ ...result, reason: 'FSU_INSTALLATION_RECORD_INVALID' });
    }
    // This key contains no account, policy, inventory or lock data.
    const record = { schema: 1, version, bootId };
    set(KEY, record);
    const readback = get(KEY, null);
    const matched = readback?.schema === 1 && readback?.version === version && readback?.bootId === bootId;
    return Object.freeze({ ...result, gmWriteRead: matched,
      previousLoad: matched && previous?.version === version && previous.bootId !== bootId,
      reason: matched ? null : 'FSU_INSTALLATION_READBACK_FAILED' });
  } catch { return Object.freeze({ ...result, reason: 'FSU_INSTALLATION_CHECK_FAILED' }); }
}
