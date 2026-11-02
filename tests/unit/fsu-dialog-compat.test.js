import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../FSU_mod/【FSU】EAFC FUT WEB 增强器-26.09_mod.user.js', import.meta.url), 'utf8');

function popupSection() {
  const start = source.indexOf('        events.popup = ');
  const end = source.indexOf('        events.wait = ', start);
  if (start < 0 || end < 0) throw new Error('FSU popup implementation was not found');
  return source.slice(start, end);
}

function ignorePlayerPopupSection() {
  const start = source.indexOf('        events.ignorePlayerPopup = ');
  const end = source.indexOf('        events.popup = ', start);
  if (start < 0 || end < 0) throw new Error('FSU player-ignore popup was not found');
  return source.slice(start, end);
}

function harness(legacy = false, customOptions = true) {
  let popup;
  function button(label) {
    return { __text: { innerHTML: label }, setText(text) { this.__text.innerHTML = text; },
      removeClass() {}, addClass() {} };
  }
  // FC27 observed contract: constructor ignores dialogOptions; the view maps
  // controls to enums. No account, EA service or mutation is used here.
  class Dialog {
    constructor(options) {
      this.options = legacy ? options.dialogOptions : undefined;
      this.continueOption = options.continueOption;
      this.cancelOption = options.cancelOption;
      this.modalDisplayDimensions = {};
      const observers = new Map();
      this.onExit = { observe: (owner, fn) => observers.set(owner, fn),
        unobserve: owner => observers.delete(owner),
        notify: value => { for (const [owner, fn] of observers) fn.call(owner, this.onExit, value); } };
      this.view = { __msg: { appendChild: vi.fn() } };
      if (legacy) this.view.dialogOptions = options.dialogOptions.map(() => button('*'));
      else {
        this.view.dialogOptionEnums = new Map();
        if (customOptions) this.view.createOption = (label, role, value) => this.view.dialogOptionEnums.set(button(label), value);
        for (const [role, option] of [['continue', options.continueOption], ['cancel', options.cancelOption]]) {
          if (option) this.view.dialogOptionEnums.set(button('localized'), option.labelEnum);
        }
      }
    }
    init() {}
    getView() { return this.view; }
    escape() { this.onExit.notify(this.cancelOption?.labelEnum ?? 1); }
  }
  class TextInput {
    constructor() { this.__root = { style: {} }; }
    init() {}
    setPlaceholder(value) { this.placeholder = value; }
    setValue(value) { this.value = value; }
    getValue() { return this.value; }
    setInteractionState() {}
  }
  class StandardButton {
    init() {}
    addTarget(_owner, callback) { this.callback = callback; }
    setText(label) { this.label = label; }
    getRootElement() { return { label: this.label, callback: this.callback }; }
  }
  const events = {};
  events.createButton = (control, label, callback) => {
    control.init(); control.setText(label); control.callback = callback;
    const root = control.getRootElement(); root.label = label; root.callback = callback; return { getRootElement: () => root };
  };
  const context = vm.createContext({ events, info: { isEnhancer: false },
    enums: { UIDialogOptions: { OK: 2, CANCEL: 1, NO: 8 } },
    EADialogViewController: Dialog, EADialogView: { Type: { MESSAGE: 'message' } }, UTTextInputControl: TextInput,
    UTStandardButtonControl: StandardButton,
    gPopupClickShield: { setActivePopup: value => { popup = value; } },
    _: { flatMap: (values, fn) => (values || []).flatMap(fn) },
    fy: key => /\.444\d+$/.test(key) ? `translated:${key}` : key,
    utils: { PopupManager: { getLocalizedDialogOption: value => `native:${value}` } },
    Array, String, Map });
  vm.runInContext(popupSection(), context);
  return { events, popup: () => popup };
}

it('renders FC27 import confirmation/cancel and preserves input and exit callbacks', () => {
  const h = harness(); const callback = vi.fn();
  h.events.popup('Import', 'Description', callback, false, ['URL', 'scheme-id'], true);
  const p = h.popup();
  expect([...p.view.dialogOptionEnums.values()]).toEqual([2, 1]);
  expect(callback).not.toHaveBeenCalled();
  p.onExit.notify(2);
  expect(callback).toHaveBeenCalledExactlyOnceWith(2, p._fsuInput);
  expect(p._fsuInput.getValue()).toBe('scheme-id');
  p.onExit.notify(2);
  expect(callback).toHaveBeenCalledOnce();
});

it('preserves the third action and never maps Escape to the website action', () => {
  const h = harness(); const callback = vi.fn();
  h.events.popup('Rating', 'Description', callback, [{ labelEnum: 2 }, { labelEnum: 44401 }, { labelEnum: 1 }]);
  const p = h.popup();
  expect([...p.view.dialogOptionEnums.values()].sort((a, b) => a - b)).toEqual([1, 2, 44401]);
  expect([...p.view.dialogOptionEnums].find(([, value]) => value === 44401)[0].__text.innerHTML)
    .toBe('translated:popupButtonsText.44401');
  expect([...p.view.dialogOptionEnums].find(([, value]) => value === 1)[0].__text.innerHTML).toBe('native:1');
  p.escape();
  expect(callback).toHaveBeenCalledExactlyOnceWith(1);
});

it.each([[2, 44403], [44408, 44409]])('retains custom action labels and cancellation for %j', (first, last) => {
  const h = harness(); const callback = vi.fn();
  h.events.popup('Custom', 'Description', callback, [{ labelEnum: first }, { labelEnum: last }]);
  const p = h.popup();
  expect([...p.view.dialogOptionEnums.values()]).toEqual([first, last]);
  expect([...p.view.dialogOptionEnums].find(([, value]) => value === last)[0].__text.innerHTML)
    .toBe(`translated:popupButtonsText.${last}`);
  p.escape();
  expect(callback).toHaveBeenCalledExactlyOnceWith(last);
});

it('keeps legacy FC26 three-button construction and styling unchanged', () => {
  const h = harness(true); const callback = vi.fn();
  const options = [{ labelEnum: 2 }, { labelEnum: 44401 }, { labelEnum: 1 }];
  h.events.popup('Legacy', 'Description', callback, options);
  const p = h.popup();
  expect(p.options).toEqual(options);
  expect(p.view.dialogOptions).toHaveLength(3);
  expect(p.view.dialogOptions[1].__text.innerHTML).toBe('translated:popupButtonsText.44401');
  expect(callback).not.toHaveBeenCalled();
});

it('offers a working Close action in the FC27 player-ignore configuration dialog', () => {
  const captured = {};
  const events = { createToggle: () => ({ toggle() {}, __root: { style: {} } }),
    getIgnoreText: () => 'unchanged', popup: vi.fn((title, message, callback, options) => {
      Object.assign(captured, { title, message, callback, options });
      return { getView: () => ({ __msg: { style: {}, appendChild: vi.fn() } }) };
    }) };
  const context = vm.createContext({ events, info: { set: { shield_league: [], shield_flag: [], goldenrange: 83 }, build: {} },
    build: { set: vi.fn() }, set: { save: vi.fn() }, fy: key => key,
    _: { forEach: (values, fn) => values.forEach(fn), isNaN: Number.isNaN }, Array, String });
  vm.runInContext(ignorePlayerPopupSection(), context);
  const label = { textContent: '' };
  events.ignorePlayerPopup(label);
  expect(captured.options.map(option => option.labelEnum)).toEqual([44404, 44407, 44405, 44403]);
  captured.callback(44403);
  expect(label.textContent).toBe('unchanged');
});

it('keeps extra ignore actions visible and reserves a native cancel button for Close when FC27 exposes only two controls', () => {
  const h = harness(false, false); const callback = vi.fn();
  h.events.popup('Ignore players', 'Description', callback, [
    { labelEnum: 44404, label: 'League exclusions' },
    { labelEnum: 44407, label: 'Rarity exclusions' },
    { labelEnum: 44405, label: 'Gold range' },
    { labelEnum: 44403, label: 'Close', close: true },
  ]);
  const p = h.popup();
  expect(p.cancelOption).toMatchObject({ labelEnum: 44403, close: true });
  expect([...p.view.dialogOptionEnums.values()]).toEqual([44404, 44403]);
  const fallback = p.view.__msg.appendChild.mock.calls.map(([root]) => root);
  expect(fallback.map(button => button.label)).toEqual(['Rarity exclusions', 'Gold range']);
  fallback[1].callback();
  expect(callback).toHaveBeenCalledExactlyOnceWith(44405);
  p.escape();
  expect(callback).toHaveBeenNthCalledWith(2, 44403);
});

it('supplies named FC27 options to every direct FSU dialog so one-button dialogs remain dismissible', () => {
  const dialogs = [...source.matchAll(/new EADialogViewController\(\{([\s\S]*?)\n\s*\}\);/g)]
    .map(match => match[1]);
  expect(dialogs).toHaveLength(7);
  expect(dialogs.every(body => /continueOption\s*:/.test(body))).toBe(true);
  expect(dialogs.filter(body => /UIDialogOptions\.CANCEL/.test(body))
    .every(body => /cancelOption\s*:/.test(body))).toBe(true);
});
