// Error metadata only: never retain native source, credentials or DTOs.
export function transactionMethodEvidence(error) {
  const result = {};
  if (typeof error?.methodPath === 'string' && /^[A-Za-z][A-Za-z0-9_.]{0,240}$/.test(error.methodPath)) {
    result.methodPath = error.methodPath;
  }
  if (typeof error?.observedHash === 'string' && (/^[a-f0-9]{64}$/.test(error.observedHash) || error.observedHash === 'oversized')) {
    result.observedHash = error.observedHash;
  }
  if (typeof error?.expectedHash === 'string' && /^[a-f0-9]{64}$/.test(error.expectedHash)) result.expectedHash = error.expectedHash;
  return result;
}
