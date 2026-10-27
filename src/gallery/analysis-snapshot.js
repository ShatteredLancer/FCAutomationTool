const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const versionFields = ['eaId', 'playerEaId', 'name', 'version', 'overall', 'galleryScore', 'gradingScore',
  'nationEaId', 'clubEaId', 'leagueEaId', 'rarityEaId', 'positions', 'weakFoot', 'skillMoves', 'holographic',
  'collected', 'inClub', 'held', 'firstOwned', 'observedFirstOwned', 'firstOwnedSource'];
const accountFacts = ['collected', 'inClub', 'held', 'firstOwned', 'gradingScore'];

// Explicit allowlist: never serialize a detail, native card, context or journal.
// One public version dictionary avoids repeating cards across club/league sets.
export function buildGalleryAnalysisSnapshot({ catalog, targets = [], plan = null, version = null, galleryLevel = null,
  catalogFetchedAt = null, now = Date.now() } = {}) {
  if (!catalog?.categories || !Array.isArray(targets)) throw Error('FC27_GALLERY_EXPORT_INPUT_INVALID');
  const versions = new Map(), bySet = new Map(targets.map(target => [target.set.id, target]));
  const collections = catalog.categories.flatMap(category => category.sets.map(set => {
    const target = bySet.get(set.id), detail = target?.progress;
    for (const row of detail?.rows ?? []) {
      if (!Number.isSafeInteger(row.eaId) || row.eaId <= 0) continue;
      const existing = versions.get(row.eaId), card = pick(row, versionFields);
      const evidenceAt = Number.isSafeInteger(row.readAt) ? row.readAt : null;
      if (!existing) versions.set(row.eaId, { ...card, evidenceAt, conflictingFields: [] });
      else {
        for (const key of accountFacts) if (existing[key] !== card[key]) {
          existing[key] = null;
          if (!existing.conflictingFields.includes(key)) existing.conflictingFields.push(key);
        }
        existing.evidenceAt = existing.evidenceAt === evidenceAt ? evidenceAt : null;
      }
    }
    const quote = target?.priceSnapshot, prices = [];
    const forecast = target?.forecastPriceBasis === 'fodder-public-estimate';
    for (const row of detail?.rows ?? []) {
      const price = target?.prices?.[row.eaId];
      if (Number.isSafeInteger(price) && price > 0) prices.push({ eaId: row.eaId, price,
        platform: forecast ? target.publicReference?.platform ?? null : quote?.platform ?? target?.platform ?? null,
        source: forecast ? 'fodder' : quote?.policy?.source ?? null,
        expiresAt: forecast ? target.forecastPriceExpiresAt : quote?.expiresAt ?? null,
        fresh: !forecast && quote?.expiresAt != null && quote.expiresAt > now,
        ...(forecast ? { forecast: true, marketObservedAt: null, fetchedAt: target.forecastPriceFetchedAt,
          capturedAt: target.forecastPriceCapturedAt ?? null,
          cacheExpired: target.forecastPriceExpiresAt != null && target.forecastPriceExpiresAt <= now } : {}) });
    }
    return { setId: set.id, categoryId: category.id, name: set.name, requiredCards: set.requiredCards,
      conditions: set.conditions ?? null, slug: set.slug ?? null, description: set.description ?? null,
      grades: set.grades.map(grade => ({ name: grade.name, threshold: grade.threshold,
        rewards: grade.rewards.map(reward => pick(reward, ['type', 'count', 'value', 'label', 'resourceId', 'assetId'])),
        rewardsComplete: grade.rewardsComplete === true })), claimState: 'unknown',
      status: target?.status ?? 'unloaded', stale: target?.stale === true || target?.poolStale === true,
      poolRevision: target?.pool?.revision ?? null, evidenceAt: target?.fetchedAt ?? null,
      progressComplete: detail?.complete === true, poolComplete: detail?.poolComplete === true,
      candidateOnly: detail?.candidateOnly === true, poolSize: detail?.poolSize ?? null,
      versionIds: (detail?.rows ?? []).map(row => row.eaId), prices,
      publicReference: target?.publicReference ? { ...pick(target.publicReference, ['source', 'basis', 'platform', 'fetchedAt', 'expiresAt', 'marketObservedAt', 'forecastOnly', 'capturedAt']),
        grades: target.publicReference.grades.map(grade => pick(grade, ['grade', 'cost', 'ids'])) } : null };
  }));
  return { schema: 1, kind: 'gallery-analysis', season: '27', applicationVersion: version, exportedAt: now,
    catalog: { ...pick(catalog, ['schema', 'season', 'source', 'revision', 'tags', 'engine']), fetchedAt: catalogFetchedAt,
      categories: catalog.categories.map(category => ({ id: category.id, name: category.name,
        setIds: category.sets.map(set => set.id) })) },
    galleryLevel: galleryLevel ? { ...pick(galleryLevel, ['status', 'source', 'exactLevel', 'galleryXp', 'confirmedAtLeast', 'observedAt', 'levelBasis']),
      consoleNote: galleryLevel.consoleNote ? pick(galleryLevel.consoleNote, ['level', 'recordedAt', 'source']) : null,
      milestones: (galleryLevel.milestones ?? []).map(row => pick(row, ['level', 'title', 'completed', 'claimed', 'rewards', 'observedAt'])) } : null,
    coverage: { total: collections.length, loaded: collections.filter(set => set.status === 'observed').length,
      complete: collections.filter(set => set.progressComplete && !set.stale).length },
    collections, versions: [...versions.values()],
    roadmap: plan ? { ...pick(plan, ['status', 'partial', 'coverage', 'baselineTokens', 'addedTokens', 'claimState', 'tokenBasis', 'generatedAt', 'fastReferences', 'priceBasis', 'demandDriven', 'quotesExpired','selectedProfile','retainedChanges']),
      portfolios:(plan.portfolios ?? []).slice(0,3).map(value=>({...pick(value,['profile','label','status','objective','addedTokens','claimState','searchComplete']),
        funding:pick(value.funding,['requiredCapital','totalPurchase','expectedNetLoss','feasible','saleBasis']),
        route:value.route.map(row=>({...pick(row,['setId','targetGrade','addedTokens']),purchaseVersionIds:row.cycles.map(cycle=>cycle.eaId)}))})),
      executionSteps:(plan.executionSteps ?? []).map(value=>pick(value,['setId','targetGrade','state'])),
      deepCoverage: plan.deepCoverage ? pick(plan.deepCoverage, ['eligible', 'completed', 'quoted', 'candidateLimit', 'pending','referencePending']) : null,
      referenceOverview: plan.referenceOverview ? { ...pick(plan.referenceOverview, ['status', 'partial', 'coverage', 'addedTokens']),
        requiredCapital: plan.referenceOverview.funding?.requiredCapital ?? null,
        route: plan.referenceOverview.route.map(row => pick(row, ['setId', 'targetGrade', 'addedTokens'])) } : null,
      forecastReference: plan.forecastReference ? { ...pick(plan.forecastReference, ['source', 'forecastOnly', 'fetchedAt', 'capturedAt', 'expiresAt']),
        cacheExpired: plan.forecastReference.expiresAt <= now } : null,
      timings: pick(plan.timings, ['referenceMs', 'syncMs', 'priceMs', 'planningMs']),
      route: (plan.route ?? []).map(row => ({ ...pick(row, ['setId', 'name', 'order', 'currentGrade', 'targetGrade',
        'currentScore', 'projectedScore', 'baselineTokens', 'projectedTokens', 'addedTokens', 'claimState']),
        purchaseVersionIds: row.cycles.map(cycle => cycle.eaId),
        ...(plan.demandDriven ? { quotedItems: row.items.map(item => ({ eaId: item.eaId, price: item.price,
          ...pick(item.roadmapQuote, ['source', 'fetchedAt', 'expiresAt']), fresh: item.roadmapQuote?.expiresAt > now })) } : {}) })),
      funding: pick(plan.funding, ['capital', 'requiredCapital', 'totalPurchase', 'expectedTax', 'expectedNetLoss',
        'expectedRemaining', 'feasible', 'taxBps', 'resaleDiscountBps', 'saleBasis']) } : null,
    interpretation: { collectedMeansEverCollected: true, currentHoldingsAreSeparate: true,
      rewardClaimsVerified: false, futureSaleIncomeIsForecastOnly: true, perVersionEvidenceTimeMayBeUnknown: true } };
}
