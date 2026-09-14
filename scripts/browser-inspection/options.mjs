export function inspectionOptions(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  let mode = null;
  let executable = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--self-test' || arg === '--interactive') {
      if (mode) throw new Error('Choose exactly one inspection mode');
      mode = arg;
    } else if (arg === '--browser') {
      if (executable || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Expected one browser executable');
      executable = args[++i];
    } else throw new Error('Unknown inspection argument');
  }
  if (!mode && args.length) throw new Error('Inspection mode required');
  return { help: !mode, selfTest: mode === '--self-test', interactive: mode === '--interactive', executable };
}
