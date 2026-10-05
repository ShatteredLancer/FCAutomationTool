// Public catalogue definitions only. No ownership, EA receipts, prices or score engine.
export const GALLERY_GRADES = Object.freeze(['D', 'C', 'B', 'A', 'S']);
const invalid = () => { throw new Error('FC27_GALLERY_CATALOG_INVALID'); };
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const text = (value, max = 500) => typeof value === 'string' && value.length > 0 && value.length <= max;
const slug = value => text(value, 160) && /^[a-z0-9][a-z0-9-]*$/.test(value);
const list = (value, max, nonempty = false) => {
  if (!Array.isArray(value) || value.length > max || nonempty && !value.length) invalid();
  return Array.from(value);
};
const unique = values => { if (new Set(values).size !== values.length) invalid(); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
// Keep unknown public rule operators for display/change detection, never execute them.
function definition(value, depth = 0) {
  if (depth > 8) invalid();
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length <= 2000) return value;
  if (Array.isArray(value)) return list(value, 256).map(row => definition(row, depth + 1));
  if (!value || typeof value !== 'object' || Object.keys(value).length > 40) return invalid();
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, definition(value[key], depth + 1)]));
}

export function galleryCanonical(value) {
  if (Array.isArray(value)) return `[${value.map(galleryCanonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${galleryCanonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function galleryCatalogRevision(catalog) {
  // Content identity, not an authentication hash. Ignore delivery/capture time.
  const value = galleryCanonical(pick(catalog, ['schema', 'season', 'source', 'categories', 'tags', 'engine']));
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  return `g1-${hash.toString(16).padStart(8, '0')}-${value.length}`;
}

function grades(rows, source) {
  const result = list(rows, 5, true).map(row => {
    if (!row) invalid();
    const name = source === 'futgg' ? row.name : row.grade;
    const threshold = source === 'futgg' ? row.threshold : row.score;
    if (!GALLERY_GRADES.includes(name) || !integer(threshold)) invalid();
    let rewards;
    if (source === 'futgg') rewards = list(row.rewards, 32).map(reward => {
      if (!text(reward?.type, 100) || !text(reward.label) || !integer(reward.value) || !integer(reward.count, 1)) invalid();
      return definition(pick(reward, ['id', 'type', 'count', 'label', 'value', 'assetId', 'itemType', 'teamEaId', 'resourceId', 'untradeable', 'itemCategory']));
    });
    else {
      if (!integer(row.tokens)) invalid();
      rewards = row.tokens ? [{ type: 'event_token_1', count: 1, value: row.tokens, label: `${row.tokens} Gallery Tokens` }] : [];
    }
    return { name, threshold, rewards, rewardsComplete: source === 'futgg' };
  }).sort((a, b) => GALLERY_GRADES.indexOf(a.name) - GALLERY_GRADES.indexOf(b.name));
  unique(result.map(row => row.name));
  if (result.length !== 5 || result.some((row, i) => i > 0 && row.threshold < result[i - 1].threshold)) invalid();
  return result;
}

export function normalizeGalleryCatalog(source, input, season = '27') {
  if (!['futgg', 'fodder'].includes(source) || season !== '27') invalid();
  const data = source === 'futgg' ? input?.data : input;
  if (!data || source === 'futgg' && (data.game !== `fc${season}` || data.schemaVersion !== 1)
      || source === 'fodder' && data.engine?.version !== 1) invalid();
  if (data.isTruncated === true || data.complete === false) invalid();
  const categoryIds = [], setIds = [];
  const categories = list(data.categories, 256, true).map(category => {
    if (!text(category?.name) || !slug(category.slug) || category.isTruncated === true
        || source === 'futgg' && !integer(category.id, 1)) invalid();
    const id = `${source}:${source === 'futgg' ? category.id : category.slug}`;
    categoryIds.push(id);
    const sets = list(category.sets, 4096).map(set => {
      if (!text(set?.name) || !slug(set.slug) || source === 'futgg' && (!integer(set.id, 1) || set.categoryId !== category.id)) invalid();
      const requiredCards = source === 'futgg' ? set.requiredCards : set.required;
      if (!integer(requiredCards, 1)) invalid();
      const setId = `${source}:${source === 'futgg' ? set.id : `${category.slug}/${set.slug}`}`;
      setIds.push(setId);
      let conditions = null;
      if (source === 'fodder') {
        for (const key of ['clubs', 'leagues', 'rareflags']) {
          const values = list(set[key], 256);
          if (!values.every(value => integer(value))) invalid();
          unique(values);
        }
        if (typeof set.holo !== 'boolean') invalid();
        conditions = definition(pick(set, ['clubs', 'leagues', 'rareflags', 'holo']));
      }
      const description = set.description ?? null;
      if (description !== null && (typeof description !== 'string' || description.length > 2000)) invalid();
      return { id: setId, categoryId: id, name: set.name, slug: set.slug, requiredCards,
        description, conditions, grades: grades(set.grades, source) };
    }).sort((a, b) => a.id.localeCompare(b.id));
    unique(sets.map(set => set.slug));
    return { id, name: category.name, slug: category.slug, sets };
  }).sort((a, b) => a.id.localeCompare(b.id));
  unique(categoryIds); unique(setIds); unique(categories.map(category => category.slug));
  if (!setIds.length || setIds.length > 10000) invalid();
  const tags = list(data.tags, 256).map(tag => {
    if (!integer(tag?.id, 1) || !text(tag.name)) invalid();
    return definition(pick(tag, source === 'futgg'
      ? ['id', 'name', 'rules', 'tiers', 'bonusType', 'thresholdType', 'description']
      : ['id', 'name', 'steps', 'match']));
  }).sort((a, b) => a.id - b.id);
  unique(tags.map(tag => tag.id));
  const capturedAt = source === 'futgg' ? data.capturedAt ?? null : null;
  if (capturedAt !== null && (typeof capturedAt !== 'string' || !Number.isFinite(Date.parse(capturedAt)))) invalid();
  const catalog = { schema: 1, source, season, seasonEvidence: source === 'futgg' ? 'response-game' : 'fc27-reviewed-endpoint',
    capturedAt, categories, tags, ...(source === 'fodder' ? { engine: definition(data.engine) } : {}) };
  return freeze({ ...catalog, revision: galleryCatalogRevision(catalog) });
}

// A small, public-only cache payload; no reach/price/account fields survive.
export function galleryCachePayload(catalog) {
  const futgg = catalog.source === 'futgg';
  const categories = catalog.categories.map(category => ({ name: category.name, slug: category.slug,
    ...(futgg ? { id: Number(category.id.split(':')[1]) } : {}),
    sets: category.sets.map(set => ({ name: set.name, slug: set.slug,
      ...(futgg ? { id: Number(set.id.split(':')[1]), categoryId: Number(category.id.split(':')[1]),
        requiredCards: set.requiredCards, description: set.description } : { required: set.requiredCards, ...set.conditions }),
      grades: set.grades.map(grade => futgg ? { name: grade.name, threshold: grade.threshold, rewards: grade.rewards }
        : { grade: grade.name, score: grade.threshold, tokens: grade.rewards.reduce((sum, r) => sum + r.count * r.value, 0) }),
    })),
  }));
  return futgg ? { data: { game: `fc${catalog.season}`, schemaVersion: 1, capturedAt: catalog.capturedAt, categories, tags: catalog.tags } }
    : { engine: catalog.engine ?? { version: 1 }, categories, tags: catalog.tags };
}

export function diffGalleryCatalog(previous, current) {
  const result = { comparable: !!previous && previous.source === current.source && previous.season === current.season,
    added: [], removed: [], renamed: [], requirements: [], rewards: [], categoriesChanged: false, tagsChanged: false };
  if (!result.comparable) return result;
  const before = new Map(previous.categories.flatMap(category => category.sets).map(set => [set.id, set]));
  const after = new Map(current.categories.flatMap(category => category.sets).map(set => [set.id, set]));
  const different = (a, b) => galleryCanonical(a) !== galleryCanonical(b);
  for (const [id, set] of after) {
    const old = before.get(id);
    if (!old) { result.added.push(id); continue; }
    if (different([old.name, old.slug], [set.name, set.slug])) result.renamed.push(id);
    const rules = row => [row.categoryId, row.requiredCards, row.description, row.conditions, row.grades.map(g => [g.name, g.threshold])];
    if (different(rules(old), rules(set))) result.requirements.push(id);
    if (different(old.grades.map(g => g.rewards), set.grades.map(g => g.rewards))) result.rewards.push(id);
  }
  for (const id of before.keys()) if (!after.has(id)) result.removed.push(id);
  result.categoriesChanged = different(previous.categories.map(c => [c.id, c.name, c.slug]), current.categories.map(c => [c.id, c.name, c.slug]));
  result.tagsChanged = different(previous.tags, current.tags);
  return result;
}
