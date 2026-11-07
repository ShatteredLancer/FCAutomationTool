const validId = value => Number.isSafeInteger(value) && value > 0;
const groupOf = (rule, item, resolveClub) => rule.kind === 'same-club'
  ? resolveClub?.(item.teamId ?? item.clubId) : item[rule.kind === 'same-nation' ? 'nationId' : 'leagueId'];
const countsOf = (rule, items, resolveClub) => {
  const result = new Map();
  for (const item of items) {
    const key = groupOf(rule, item, resolveClub);
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
};
const suffixCount = (indices, start) => {
  let low = 0, high = indices.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (indices[middle] < start) low = middle + 1; else high = middle;
  }
  return indices.length - low;
};

// Necessary capacity only: physical copies and independently applied caps can
// overestimate availability, never prove a particular lineup or chemistry.
// A four-player club cannot be completed from five same-country players when
// that country is capped at three. Apply this both before and during traversal.
export function createPuzzleGroupCapacity({ rules, candidates, resolveClub }) {
  const minima = rules.filter(rule => rule.kind.startsWith('same-') && rule.mode !== 'max' && rule.value >= 2);
  const caps = rules.filter(rule => rule.kind.startsWith('same-') && rule.mode !== 'min');
  if (!minima.some(rule => caps.some(cap => cap.kind !== rule.kind))) return [];
  // Unknown identities remain the responsibility of the original validator.
  if ([...minima, ...caps].some(rule => candidates.some(item => !validId(groupOf(rule, item, resolveClub))))) return [];
  return minima.filter(rule => caps.some(cap => cap.kind !== rule.kind)).map(rule => {
    const groups = new Map();
    candidates.forEach((item, index) => {
      const key = groupOf(rule, item, resolveClub);
      if (!groups.has(key)) groups.set(key, { indices: [], definitions: new Set(), caps: caps.map(cap => ({ cap, groups: new Map() })) });
      const group = groups.get(key);
      group.indices.push(index); group.definitions.add(item.definitionId);
      for (const entry of group.caps) {
        const value = groupOf(entry.cap, item, resolveClub);
        if (!entry.groups.has(value)) entry.groups.set(value, []);
        entry.groups.get(value).push(index);
      }
    });
    const capacity = (group, start, usedCaps) => {
      let upper = suffixCount(group.indices, start);
      for (const entry of group.caps) {
        const used = usedCaps.get(entry.cap);
        let capped = 0;
        for (const [key, indices] of entry.groups) {
          capped += Math.min(suffixCount(indices, start), Math.max(0, entry.cap.value - (used?.get(key) ?? 0)));
        }
        upper = Math.min(upper, capped);
      }
      return upper;
    };
    for (const [key, group] of groups) {
      if (Math.min(group.definitions.size, capacity(group, 0, new Map())) < rule.value) groups.delete(key);
    }
    return {
      rule,
      groupIds: [...groups].sort((a, b) => a[1].definitions.size - b[1].definitions.size || a[0] - b[0]).map(([key]) => key),
      matches: candidates.map(item => groups.has(groupOf(rule, item, resolveClub))),
      canReach(chosen, start, remaining) {
        const counts = countsOf(rule, chosen, resolveClub);
        const usedCaps = new Map(caps.map(cap => [cap, countsOf(cap, chosen, resolveClub)]));
        for (const [key, group] of groups) {
          const used = counts.get(key) ?? 0;
          if (used >= rule.value || used + Math.min(remaining, capacity(group, start, usedCaps)) >= rule.value) return true;
        }
        return false;
      },
    };
  });
}
