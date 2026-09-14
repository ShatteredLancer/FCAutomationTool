import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadUserscript } from '../tests/helpers/load-userscript.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = JSON.parse(await readFile(path.join(root, 'FCAutomationTool.loops.json'), 'utf8'));
const { api } = await loadUserscript();
const config = api.normalizeLoopConfig(json);

api.validateLoopConfig(config, 'FCAutomationTool.loops.json');
api.validateLoopConfig({
  loops: api.LOOP_DEFS,
  recoveryRecipes: api.RECOVERY_RECIPES,
  unassignedRecoveryPolicies: api.UNASSIGNED_RECOVERY_POLICIES,
  defaultUnassignedRecoveryPolicyIds: api.DEFAULT_UNASSIGNED_RECOVERY_POLICY_IDS,
}, 'built-in config');

const builtInIds = api.LOOP_DEFS.map((loop) => loop.id);
const externalIds = config.loops.map((loop) => loop.id);
if (JSON.stringify(builtInIds) !== JSON.stringify(externalIds)) {
  throw new Error(`Built-in/external loop order differs:\nbuilt-in: ${builtInIds.join(', ')}\nexternal: ${externalIds.join(', ')}`);
}

const builtInRecipeIds = api.RECOVERY_RECIPES.map((recipe) => recipe.id);
const externalRecipeIds = config.recoveryRecipes.map((recipe) => recipe.id);
if (JSON.stringify(builtInRecipeIds) !== JSON.stringify(externalRecipeIds)) {
  throw new Error(`Built-in/external recovery recipe order differs:\nbuilt-in: ${builtInRecipeIds.join(', ')}\nexternal: ${externalRecipeIds.join(', ')}`);
}

const builtInPolicyIds = api.UNASSIGNED_RECOVERY_POLICIES.map((policy) => policy.id);
const externalPolicyIds = config.unassignedRecoveryPolicies.map((policy) => policy.id);
if (JSON.stringify(builtInPolicyIds) !== JSON.stringify(externalPolicyIds)) {
  throw new Error(`Built-in/external recovery policy order differs:\nbuilt-in: ${builtInPolicyIds.join(', ')}\nexternal: ${externalPolicyIds.join(', ')}`);
}

console.log(`Validated ${config.loops.length} external/built-in loops, ${config.recoveryRecipes.length} recovery recipes, and ${config.unassignedRecoveryPolicies.length} recovery policies`);
