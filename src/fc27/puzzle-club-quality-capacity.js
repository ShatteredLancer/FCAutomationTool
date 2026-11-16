const suffixCount = (indices, start) => {
  let low = 0, high = indices.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (indices[middle] < start) low = middle + 1; else high = middle;
  }
  return indices.length - low;
};

// Optimistic capacity only. Physical copies, other constraints, prices and
// positions are deliberately ignored: they may reduce actual feasibility,
// never make this upper bound smaller than a valid native completion.
export function createPuzzleClubQualityCapacity({ candidates, matches, minimum, clubLimit, resolveClub }) {
  const groups = new Map();
  for (let index = 0; index < candidates.length; index++) {
    const key = resolveClub(candidates[index].teamId ?? candidates[index].clubId);
    if (!groups.has(key)) groups.set(key, { all: [], matching: [] });
    const group = groups.get(key); group.all.push(index);
    if (matches[index]) group.matching.push(index);
  }
  return {
    canReach(chosen, start, remaining, usedMatches) {
      const usedClubs = new Set(chosen.map(item => resolveClub(item.teamId ?? item.clubId)));
      const slots = clubLimit - usedClubs.size;
      if (slots < 0) return false;
      const needed = Math.max(0, minimum - usedMatches);
      if (needed > remaining) return false;
      let freeTotal = 0, freeMatching = 0;
      const choices = [];
      for (const [key, group] of groups) {
        const total = suffixCount(group.all, start);
        if (!total) continue;
        const matching = suffixCount(group.matching, start);
        if (usedClubs.has(key)) { freeTotal += total; freeMatching += matching; }
        else choices.push({ total, matching });
      }
      if (freeTotal >= remaining && freeMatching >= needed) return true;
      const count = Math.min(slots, choices.length);
      if (freeTotal + choices.map(group => group.total).sort((a, b) => b - a).slice(0, count).reduce((a, b) => a + b, 0) < remaining
          || freeMatching + choices.map(group => group.matching).sort((a, b) => b - a).slice(0, count).reduce((a, b) => a + b, 0) < needed) return false;
      if (needed === 0 || needed === remaining) return true;
      // Keep both capacities on the SAME set of at most `count` new clubs.
      // Independent top-N totals falsely combine silver-rich clubs with a
      // different set of gold-rich clubs. At most 12 x 12 small DP states.
      const dp = Array.from({ length: count + 1 }, () => Array(needed + 1).fill(-1));
      dp[0][Math.min(needed, freeMatching)] = Math.min(remaining, freeTotal);
      for (const group of choices) for (let clubs = count; clubs > 0; clubs--) {
        for (let quality = 0; quality <= needed; quality++) {
          if (dp[clubs - 1][quality] < 0) continue;
          const nextQuality = Math.min(needed, quality + group.matching);
          dp[clubs][nextQuality] = Math.max(dp[clubs][nextQuality], Math.min(remaining, dp[clubs - 1][quality] + group.total));
          if (dp[clubs][needed] >= remaining) return true;
        }
      }
      return false;
    },
  };
}
