// Milestone completion is not the exact current Gallery level or Gallery XP.
export function projectGalleryLevelMilestones(groups = [], observedAt = null) {
  const milestones = [];
  for (const group of groups) for (const objective of group.objectives ?? []) {
    const match = /^Reach Gallery Level (\d+)\.$/i.exec(objective.description ?? '');
    const level = match ? Number(match[1]) : null;
    if (!Number.isSafeInteger(level) || level < 1 || level > 1000) continue;
    const completed = [2, 3].includes(objective.state) ? true : objective.state === 1 ? false : null;
    milestones.push({ level, objectiveId: objective.id, title: objective.title ?? `Level ${level}`,
      completed, claimed: objective.state === 3 ? true : objective.state === 2 ? false : null,
      rewards: (objective.rewards ?? []).filter(value => typeof value === 'string').slice(0, 10),
      availableInWebUi: objective.companion === true, observedAt });
  }
  milestones.sort((a, b) => a.level - b.level);
  const confirmed = milestones.filter(row => row.completed === true);
  const confirmedAtLeast = confirmed.length ? Math.max(...confirmed.map(row => row.level)) : null;
  return { status: milestones.length ? 'observed' : 'unavailable', source: 'ea-gallery-objective-milestones',
    exactLevel: null, galleryXp: null, confirmedAtLeast,
    nextMilestone: milestones.find(row => row.level > (confirmedAtLeast ?? 0) && row.completed !== true) ?? null,
    observedAt, milestones, levelBasis: 'milestone-lower-bound-not-exact-level' };
}
