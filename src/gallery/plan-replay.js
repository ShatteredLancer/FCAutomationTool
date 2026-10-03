import { compileGalleryScoringRules } from './scoring.js';

const numeric = ['eaId', 'playerEaId', 'overall', 'gradingScore', 'galleryScore', 'nationEaId',
  'clubEaId', 'leagueEaId', 'rarityEaId', 'weakFoot', 'skillMoves'];
const flags = ['collected', 'held', 'inClub', 'firstOwned', 'holographic'];
const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000;
const gradeName = value => typeof value === 'string' && /^[A-S][+-]?$/.test(value);

// Only the current bounded Gallery input, never raw EA objects or account
// identifiers. Public version IDs are necessary to replay cross-set identity.
export function createGalleryPlanReplay(input) {
  try {
    const joint = Array.isArray(input?.targets), targets = joint ? input.targets : [input];
    if (!targets.length || targets.length > 4
        || targets.reduce((n, target) => n + target.progress.rows.length, 0) > 512) return null;
    const clean = targets.map(target => {
      const { set, catalog, progress, prices = {}, targetGrade } = target;
      if (!/^futgg:[1-9]\d{0,8}$/.test(set.id) || !integer(set.requiredCards) || set.requiredCards < 1
          || !Array.isArray(set.grades) || set.grades.length > 10
          || !(gradeName(targetGrade) || integer(targetGrade))
          || compileGalleryScoringRules(catalog).status !== 'ready') throw Error('invalid');
      const tags = catalog.tags.map(tag => {
        const rule = tag.rules[0];
        if (rule.values.length > 256 || rule.values.some(value => !/^[A-Za-z0-9_-]{1,24}$/.test(String(value)))
            || tag.tiers.length > 256) throw Error('invalid');
        return { id: tag.id, name: `Rule ${tag.id}`, bonusType: tag.bonusType, thresholdType: tag.thresholdType,
          rules: [{ attribute: rule.attribute, type: rule.type, target: rule.target, values: rule.values.map(String) }],
          tiers: tag.tiers.map(tier => ({ minItems: tier.minItems, bonus: tier.bonus })) };
      });
      const rows = progress.rows.map(row => {
        const clean = {};
        for (const key of numeric) if (row[key] == null || integer(row[key])) clean[key] = row[key] ?? null;
        else throw Error('invalid');
        for (const key of flags) if (row[key] == null || typeof row[key] === 'boolean') clean[key] = row[key] ?? null;
        else throw Error('invalid');
        if (row.positions != null) {
          if (!Array.isArray(row.positions) || row.positions.length > 32
              || row.positions.some(value => !/^[A-Z0-9]{1,5}$/.test(String(value)))) throw Error('invalid');
          clean.positions = row.positions.map(String);
        }
        return clean;
      });
      const quotes = {};
      for (const row of rows) if (integer(prices[row.eaId]) && prices[row.eaId] > 0) quotes[row.eaId] = prices[row.eaId];
      return { set: { id: set.id, requiredCards: set.requiredCards, grades: set.grades.map(grade => {
        if (!gradeName(grade.name) || !integer(grade.threshold)) throw Error('invalid');
        return { name: grade.name, threshold: grade.threshold };
      }) }, catalog: { source: 'futgg', tags }, progress: { season: '27', setId: Number(set.id.slice(6)),
        complete: progress.complete !== false, candidateOnly: progress.candidateOnly === true,
        poolComplete: progress.poolComplete !== false, rows }, prices: quotes, targetGrade };
    });
    if (joint && input.budget != null && !integer(input.budget)) return null;
    return { schema: 1, mode: joint ? 'joint' : 'grade',
      input: joint ? { targets: clean, budget: input.budget ?? null } : clean[0] };
  } catch { return null; }
}
