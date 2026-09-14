import { ownData, OBSERVED_ROOTS, projectInspectionReport } from '../../fc27/prelaunch-contract.js';

export function inspectFc27Environment(root, pageKind = 'unsupported') {
  const observed = {};
  for (const key of OBSERVED_ROOTS) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(root, key);
      observed[key] = !descriptor ? 'absent' : Object.hasOwn(descriptor, 'value') ? 'data' : 'accessor';
    } catch { observed[key] = 'unknown'; }
  }
  const rawSeason = ownData(root, 'APP_YEAR_SHORT');
  const season = typeof rawSeason === 'number' && Number.isInteger(rawSeason) ? String(rawSeason) : rawSeason;
  return projectInspectionReport({ season, pageKind, observed });
}
