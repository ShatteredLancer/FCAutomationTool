// Shared read-only boundary: manual/scheduled listing cannot overwrite an
// unresolved automatic relist. Purchase journal behavior remains independent.
export async function assertGalleryRelistSettled(get, scope) {
  const record = await get(`fcat-fc27-gallery-auto-relist-v1:${scope}`, null);
  if (record === null) return;
  if (record.schema !== 1 || record.scope !== scope || !['armed', 'disarmed', 'running', 'blocked', 'completed'].includes(record.status)) {
    throw Error('FC27_GALLERY_RELIST_RECORD_INVALID');
  }
  if (record.status === 'running' || record.pending != null) throw Error('FC27_GALLERY_RELIST_RECOVERY_REQUIRED');
}
