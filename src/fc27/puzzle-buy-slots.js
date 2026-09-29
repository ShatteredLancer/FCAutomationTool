// EA may replace each concept independently after Item.move. Accept any subset
// of exact, acknowledged replacements; never another copy of the same version.
export function puzzleBuySlotRefs(base, entries = []) {
  return base.slots.map(slot => {
    if (!slot) return null;
    const entry = entries.find(entry => entry.slot === slot.slot && entry.state === 'club');
    return { slot: slot.slot, id: entry?.itemId ?? (slot.kind === 'concept' ? slot.definitionId : slot.id),
      definitionId: slot.definitionId, concept: !entry && slot.kind === 'concept' };
  });
}

export function puzzleBuyMatchesSlots(record, slots) {
  if (!Array.isArray(slots) || slots.length !== record.base.slots.length) return false;
  const old = puzzleBuySlotRefs(record.base, record.applied);
  const next = puzzleBuySlotRefs(record.base, record.entries);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return slots.every((slot, i) => same(slot, old[i]) || same(slot, next[i]));
}
