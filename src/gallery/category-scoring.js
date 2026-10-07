// Work completion and score certainty are independent. A completed interval
// is a result, not pending queue work or proof that a network sync failed.
export function galleryCategoryScoring(rows) {
  const counts = { total: rows.length, completed: 0, pending: 0, missing: 0, unavailable: 0,
    intervals: 0, collectionUnknown: 0, ruleDifference: 0 };
  for (const { detail, summary } of rows) {
    if (!detail?.progress) counts.missing++;
    else if (!summary || summary.status === 'calculating') counts.pending++;
    else if (Number.isFinite(summary.low?.total) && Number.isFinite(summary.high?.total)) {
      counts.completed++;
      if (summary.low.total !== summary.high.total) counts.intervals++;
      if (summary.collectionUnknown) counts.collectionUnknown++;
      if (summary.ruleDifference) counts.ruleDifference++;
    } else counts.unavailable++;
  }
  return counts;
}
