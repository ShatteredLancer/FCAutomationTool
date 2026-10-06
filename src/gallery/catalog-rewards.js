// Catalogue quantities only: item `value` can be an asset ID, not an amount.
export function galleryRewardIdentity(reward) {
  if (!reward || typeof reward.type !== 'string' || !Number.isSafeInteger(reward.count) || reward.count < 1
      || !Number.isSafeInteger(reward.value) || reward.value < 0) return null;
  const token = /^event_token_\d+$/.test(reward.type);
  const key = token ? reward.type : JSON.stringify([reward.type, reward.itemType ?? null,
    reward.resourceId ?? null, reward.assetId ?? null, reward.teamEaId ?? null,
    reward.itemCategory ?? null, reward.value, reward.untradeable ?? null]);
  const quantity = token ? reward.count * reward.value : reward.count;
  if (!Number.isSafeInteger(quantity)) return null;
  return { key, quantity, label: token ? reward.type === 'event_token_1' ? 'Gallery Tokens' : reward.type : reward.label ?? reward.type };
}

export function galleryRewardOptions(targets) {
  const options = new Map();
  for (const target of targets ?? []) for (const grade of target.set?.grades ?? []) for (const reward of grade.rewards ?? []) {
    const entry = galleryRewardIdentity(reward);
    if (entry) options.set(entry.key, { key: entry.key, label: entry.label });
  }
  return [...options.values()].sort((a, b) => (a.key === 'event_token_1' ? -1 : b.key === 'event_token_1' ? 1 : a.key.localeCompare(b.key)));
}

export function galleryCatalogGrade(set, summary) {
  if (summary?.full !== true || !Number.isSafeInteger(summary.low?.total)) return null;
  // Equal thresholds follow the catalogue's ascending grade order.
  return (set.grades ?? []).filter(grade => grade.threshold <= summary.low.total)
    .sort((a, b) => b.threshold - a.threshold || set.grades.indexOf(b) - set.grades.indexOf(a))[0] ?? null;
}

export function galleryGradeRewardQuantity(grade, key) {
  return (grade?.rewards ?? []).reduce((sum, reward) => {
    const entry = galleryRewardIdentity(reward);
    return sum + (entry?.key === key ? entry.quantity : 0);
  }, 0);
}

export function galleryCumulativeRewardQuantity(set, score, key) {
  if (!Number.isSafeInteger(score) || score < 0) return 0;
  return (set.grades ?? []).filter(grade => grade.threshold <= score)
    .reduce((sum, grade) => sum + galleryGradeRewardQuantity(grade, key), 0);
}

// Shared presentation snapshot. Fullness is required: points from an
// incomplete lineup do not unlock a grade. No account claim state is inferred.
export function gallerySetRewardSummary(set, summary) {
  const grade = galleryCatalogGrade(set, summary);
  const unlocked = grade ? set.grades.filter(row => row.threshold <= summary.low.total) : [];
  return { grade: grade?.name ?? null, claimState: 'unknown',
    rewardsComplete: unlocked.every(row => row.rewardsComplete === true),
    rewards: galleryRewardOptions([{ set: { grades: unlocked } }]).map(option => ({ ...option,
      quantity: galleryCumulativeRewardQuantity(set, summary.low.total, option.key) })) };
}

export function galleryTierRewardSummary(set, grade) {
  return { tier: { rewardsComplete: grade.rewardsComplete === true,
    rewards: galleryRewardOptions([{ set: { grades: [grade] } }]).map(option => ({ ...option,
      quantity: galleryGradeRewardQuantity(grade, option.key) })) },
  cumulative: gallerySetRewardSummary(set, { full: true, low: { total: grade.threshold } }) };
}

export function galleryCatalogRewardSnapshot(results, key) {
  const targets = results.map(({ target, summary }) => {
    const grade = galleryCatalogGrade(target.set, summary);
    const unlocked = grade ? target.set.grades.filter(row => row.threshold <= summary.low.total) : [];
    return { setId: target.set.id, name: target.set.name, grade: grade?.name ?? null,
      score: summary.low?.total ?? null,
      quantity: grade ? galleryCumulativeRewardQuantity(target.set, summary.low.total, key) : 0,
      rewardsComplete: summary.full === true && unlocked.every(row => row.rewardsComplete === true),
      rewards: unlocked.flatMap(row => (row.rewards ?? []).map(reward => ({ ...reward }))) };
  });
  return { quantity: targets.reduce((sum, target) => sum + target.quantity, 0), targets };
}
