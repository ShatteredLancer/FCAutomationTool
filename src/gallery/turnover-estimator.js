import { forecastGalleryTurnover } from './turnover-budget.js';

// Metrics only, inside one immutable route-comparison job. Real selected
// routes still use the full public forecast for cycles, receipts and output.
// Reuse up to eight unchanged ordered prefixes; no persistent cache/GM state.
export function createGalleryTurnoverEstimator(options = {}) {
  const config = { ...options, optimizeOrder: false };
  const empty = forecastGalleryTurnover({ ...config, steps: [] });
  const compiled = new WeakMap();
  let previous = [], prefixes = new Map(), processedCycles = 0, reusedSteps = 0;
  const full = steps => forecastGalleryTurnover({ ...config, steps });
  return {
    stats: () => ({ processedCycles, reusedSteps, prefixCount: prefixes.size }),
    estimate(steps) {
      if (empty.status !== 'estimated' || !Array.isArray(steps) || steps.length > 4096) return full(steps);
      let common = 0;
      while (common < steps.length && common < previous.length
        && steps[common]?.setId === previous[common].setId && steps[common]?.items === previous[common].items) common++;
      let start = 0, loss = 0, required = 0, versions = new Map();
      for (const [index, state] of prefixes) if (index <= common && index > start) {
        start = index; loss = state.loss; required = state.required; versions = new Map(state.versions);
      }
      reusedSteps += start;
      const next = new Map([...prefixes].filter(([index]) => index <= start));
      const stride = Math.max(1, Math.ceil(steps.length / 8));
      for (let i = start; i < steps.length; i++) {
        const step = steps[i];
        if (typeof step?.setId !== 'string' || !step.setId || !Array.isArray(step.items)) return full(steps);
        if (!compiled.has(step.items)) compiled.set(step.items,
          forecastGalleryTurnover({ resaleDiscountBps: config.resaleDiscountBps, taxBps: config.taxBps,
            optimizeOrder: false, steps: [{ setId: 'forecast', items: step.items }] }));
        const solo = compiled.get(step.items);
        if (solo.status !== 'estimated') return full(steps);
        for (const cycle of solo.steps[0].cycles) {
          processedCycles++;
          const before = versions.get(cycle.eaId);
          if (before && (before.price !== cycle.price || before.resalePrice !== cycle.resalePrice)) return full(steps);
          if (before) continue;
          versions.set(cycle.eaId, cycle);
          required = Math.max(required, loss + cycle.price);
          loss += cycle.price - cycle.expectedSaleNet;
        }
        const index = i + 1;
        if (versions.size <= 8192 && (index % stride === 0 || index === steps.length))
          next.set(index, { loss, required, versions: new Map(versions) });
      }
      // Keep only immutable keys, not caller-owned step wrappers.
      previous = steps.map(step => ({ setId: step.setId, items: step.items }));
      prefixes = new Map([...next].slice(-8));
      const requiredCapital = Math.max(0, required), capital = config.capital ?? null;
      return { status: 'estimated', requiredCapital, expectedNetLoss: loss,
        feasible: capital === null ? null : capital >= requiredCapital,
        capitalShortfall: capital === null ? null : Math.max(0, requiredCapital - capital) };
    },
  };
}
