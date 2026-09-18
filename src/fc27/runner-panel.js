export function createRunnerPanelController({ read, preview, publish }) {
  let busy = false;
  let disposed = false;
  let snapshot = null;
  const emit = result => { if (!disposed) publish({ busy, snapshot, result, liveExecutionEnabled: false }); };
  const refresh = () => {
    if (busy || disposed) return false;
    try { snapshot = read(); }
    catch { snapshot = { inputs: { status: 'blocked', reason: 'FC27_RUNNER_INSPECTION_UNAVAILABLE' }, targets: [] }; }
    emit(null);
    return true;
  };
  return {
    refresh,
    async preview(setId, maxRating = 74) {
      if (busy || disposed) return false;
      refresh();
      if (snapshot.inputs.status !== 'observed' || !snapshot.targets.some(target => target.setId === setId)
          || ![74, 83].includes(maxRating)) return false;
      busy = true;
      emit(null);
      let result;
      try { result = await preview({ setId, maxRating }); }
      catch { result = { status: 'blocked', reason: 'FC27_RUNNER_PREVIEW_UNAVAILABLE' }; }
      finally { busy = false; }
      emit(result);
      return true;
    },
    dispose() { disposed = true; snapshot = null; },
  };
}
