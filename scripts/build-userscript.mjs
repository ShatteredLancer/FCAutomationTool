import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFc27Production } from './build-fc27-production.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifact = await buildFc27Production();
await mkdir(path.join(root, 'dist'), { recursive: true });
for (const name of ['FCAutomationTool.user.js', 'dist/FCAutomationTool.user.js']) {
  await writeFile(path.join(root, name), artifact.script);
}
await writeFile(path.join(root, 'dist/FCAutomationTool.meta.js'), `${artifact.metadata}\n`);
await writeFile(path.join(root, 'dist/FCAutomationTool.manifest.json'), `${JSON.stringify(artifact.manifest, null, 2)}\n`);
console.log(`Built FC Automation Tool ${artifact.version}; Live: ${artifact.manifest.liveExecutionEnabled}, scope: ${artifact.manifest.releaseScope}, release approved: ${artifact.manifest.releaseEligible} (${artifact.manifest.bytes} bytes)`);
