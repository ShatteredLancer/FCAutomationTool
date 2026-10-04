// DOM binding of Enhancer 27.0.0.4 Yh (slider-values / slider-track /
// slider-range / slider-thumb). The source component uses React/Base UI;
// FCAT supplies DOM bindings, keeping its two values, neighbour bounds,
// immediate onValueChange, labels, tooltips and endpoint layout.
// Reference: artifacts/fodder-research/enhancer-index-readable.js, Yh/fMt/cMt.
export function mountListingRange({ document, parent, label, labels, min, max, value, onValueChange, enabled }) {
  const add = (parent, tag, className, text = '') => {
    const node = document.createElement(tag); node.className = className; node.textContent = text; parent.append(node); return node;
  };
  const root = add(parent, 'div', 'listing-range'); root.dataset.slot = 'slider';
  add(root, 'strong', '', label);
  const box = add(root, 'div', 'listing-range-box'), control = add(box, 'div', 'listing-range-control');
  const track = add(control, 'div', 'listing-range-track'); track.dataset.slot = 'slider-track';
  const indicator = add(track, 'div', 'listing-range-indicator'); indicator.dataset.slot = 'slider-range';
  const values = add(box, 'div', 'listing-range-values'); values.dataset.slot = 'slider-values';
  const ends = add(root, 'div', 'listing-range-ends'); add(ends, 'span', '', String(min)); add(ends, 'span', '', String(max));
  let current = [...value];
  const numbers = [], thumbs = [], tips = [];
  const render = () => {
    const lo = (current[0] - min) / (max - min) * 100, hi = (current[1] - min) / (max - min) * 100;
    indicator.style.left = `${lo}%`; indicator.style.width = `${hi - lo}%`;
    numbers.forEach((input, index) => {
      // Yh's numeric inputs reject crossing the neighbouring value.
      input.min = String(current[index - 1] ?? min); input.max = String(current[index + 1] ?? max);
      input.value = String(current[index]); thumbs[index].value = String(current[index]);
      thumbs[index].setAttribute('aria-valuemin', input.min); thumbs[index].setAttribute('aria-valuemax', input.max);
      tips[index].textContent = String(current[index]); tips[index].style.left = `${index ? hi : lo}%`;
    });
  };
  const update = (index, next) => {
    if (!Number.isFinite(next) || next < (current[index - 1] ?? min) || next > (current[index + 1] ?? max)) { render(); return; }
    if (next === current[index]) return;
    current = current.map((old, at) => at === index ? next : old); render(); onValueChange([...current]);
  };
  for (let index = 0; index < 2; index++) {
    const thumb = add(control, 'input', 'listing-range-thumb'); thumb.type = 'range'; thumb.min = String(min); thumb.max = String(max); thumb.step = '1';
    thumb.dataset.slot = 'slider-thumb'; thumb.setAttribute('aria-label', `${labels[index]}滑块`);
    const tip = add(control, 'span', 'listing-range-tooltip'); tip.hidden = true;
    const input = add(values, 'input', ''); input.type = 'number'; input.step = '1'; input.setAttribute('aria-label', labels[index]);
    numbers.push(input); thumbs.push(thumb); tips.push(tip);
    thumb.addEventListener('input', event => {
      if (!event.isTrusted || !enabled()) return;
      const next = Math.max(current[index - 1] ?? min, Math.min(current[index + 1] ?? max, Number(thumb.value)));
      tip.hidden = false; update(index, next);
    });
    for (const event of ['change', 'blur', 'pointerup']) thumb.addEventListener(event, () => { tip.hidden = true; });
    input.addEventListener('input', event => { if (event.isTrusted && enabled() && input.value !== '') update(index, input.valueAsNumber); });
    input.addEventListener('blur', render);
  }
  // Track clicks select the closest thumb, also allowing equal thumbs to split.
  let dragging = null;
  const move = event => {
    const bounds = control.getBoundingClientRect();
    const next = Math.round(min + Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * (max - min));
    if (dragging === null) dragging = Math.abs(next - current[0]) < Math.abs(next - current[1]) ? 0 : next < current[0] ? 0 : 1;
    update(dragging, Math.max(current[dragging - 1] ?? min, Math.min(current[dragging + 1] ?? max, next)));
    tips[dragging].hidden = false;
  };
  control.addEventListener('pointerdown', event => {
    if (!event.isTrusted || !enabled() || event.button !== 0) return;
    event.preventDefault(); move(event); control.setPointerCapture(event.pointerId); thumbs[dragging].focus({ preventScroll: true });
  });
  control.addEventListener('pointermove', event => { if (dragging !== null && enabled()) move(event); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) control.addEventListener(name, () => { dragging = null; tips.forEach(tip => { tip.hidden = true; }); });
  render();
  return { root, setValue(next) { current = [...next]; render(); }, getValue: () => [...current] };
}

export const listingRangeStyles = `
  .listing-range{display:flex;flex-direction:column;gap:10px}
  .listing-range-box{display:flex;flex-direction:column;gap:10px;border:1px solid #888;border-radius:8px;padding:10px;background:#424646}
  .listing-range-control{position:relative;height:8px;display:flex;align-items:center;touch-action:none;user-select:none;margin:4px 0}
  .listing-range-track{position:relative;width:100%;height:8px;border-radius:999px;background:#727575;overflow:hidden}
  .listing-range-indicator{position:absolute;height:100%;background:#27ae60}
  #gallery-bulk-list-dialog .listing-range-thumb{position:absolute;inset:0;width:calc(100% + 20px);height:20px;margin:-6px -10px;padding:0;border:0;appearance:none;background:transparent;pointer-events:none}
  .listing-range-thumb::-webkit-slider-thumb{appearance:none;width:20px;height:20px;border:2px solid #27ae60;background:#303535;border-radius:50%;pointer-events:auto;cursor:grab}
  .listing-range-thumb:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px #27ae6060}
  .listing-range-tooltip{position:absolute;bottom:20px;transform:translateX(-50%);padding:3px 6px;background:#111;color:#fff;border-radius:4px;font-size:12px}
  .listing-range-values{display:flex;align-items:center;gap:10px}
  #gallery-bulk-list-dialog .listing-range-values>input{flex:1;min-width:0;background:#484c4c;height:40px;font-variant-numeric:tabular-nums}
  .listing-range-values input::-webkit-inner-spin-button{opacity:1}
  .listing-range-ends{display:flex;justify-content:space-between;font-size:12px}
`;
