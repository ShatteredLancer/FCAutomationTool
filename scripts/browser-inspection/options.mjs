export function fsuSetupOptions(args) {
  if (args.includes('--preview')) {
    if (args.filter(arg => arg === '--preview').length !== 1) throw new Error('Duplicate preview option');
    return { ...fsuSetupOptions(args.filter(arg => arg !== '--preview')), preview: true };
  }
  if (!args.length) return {};
  if (args.length !== 2 || args[0] !== '--proxy' || !args[1]) throw new Error('Expected --proxy loopback:port');
  const proxy = new URL(args[1].includes('://') ? args[1] : `http://${args[1]}`);
  if (!['http:', 'socks5:'].includes(proxy.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(proxy.hostname)
    || !proxy.port || Number(proxy.port) < 1 || proxy.username || proxy.password
    || proxy.pathname && proxy.pathname !== '/' || proxy.search || proxy.hash) {
    throw new Error('Setup proxy must be a loopback HTTP or SOCKS5 endpoint without credentials');
  }
  return { proxy: { server: `${proxy.protocol}//${proxy.host}`, bypass: 'localhost,127.0.0.1,[::1]' } };
}

export function inspectionOptions(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  let mode = null;
  let executable = null;
  let durationSeconds = null;
  let withExtensions = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--self-test' || arg === '--interactive' || arg === '--auto' || arg === '--agent') {
      if (mode) throw new Error('Choose exactly one inspection mode');
      mode = arg;
    } else if (arg === '--browser') {
      if (executable || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Expected one browser executable');
      executable = args[++i];
    } else if (arg === '--duration-seconds') {
      const value = args[++i];
      if (durationSeconds !== null || !/^\d+$/.test(value || '') || Number(value) < 1 || Number(value) > 600) {
        throw new Error('Expected one duration between 1 and 600 seconds');
      }
      durationSeconds = Number(value);
    } else if (arg === '--with-extensions') {
      if (withExtensions) throw new Error('Duplicate extension option');
      withExtensions = true;
    } else throw new Error('Unknown inspection argument');
  }
  if (!mode && args.length) throw new Error('Inspection mode required');
  if (durationSeconds !== null && mode !== '--auto') throw new Error('Automatic mode required');
  if (withExtensions && mode !== '--auto' && mode !== '--agent') throw new Error('Automatic or agent mode required');
  return { help: !mode, selfTest: mode === '--self-test', interactive: mode === '--interactive',
    auto: mode === '--auto', agent: mode === '--agent', durationSeconds: durationSeconds ?? 120, withExtensions, executable };
}
