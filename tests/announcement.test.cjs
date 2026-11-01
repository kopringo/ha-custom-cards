// Contract/lifecycle tests using a minimal UI stub, not a browser DOM.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '..', 'dist', 'ha-custom-cards.js'), 'utf8');

function node() {
  return { value: '', textContent: '', disabled: false, readOnly: false,
    attrs: {}, setAttribute(k, v) { this.attrs[k] = v; },
    classList: { toggle() {} }, focus() {} };
}
function setup({ secure = true, speech = true, config: override } = {}) {
  const elements = new Map(), calls = [], recognitions = [];
  class Recognition {
    constructor() { recognitions.push(this); }
    start() { this.started = true; this.onstart?.(); }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
    result(parts) {
      this.onresult?.({ results: parts.map(([text, isFinal]) => Object.assign([{ transcript: text }], { isFinal })) });
    }
    end() { this.onend?.(); }
    error(error) { this.onerror?.({ error }); }
  }
  const window = { isSecureContext: secure };
  if (speech) window.SpeechRecognition = Recognition;
  const context = vm.createContext({
    window, setTimeout, clearTimeout, CustomEvent,
    HTMLElement: class { attachShadow() { this.shadowRoot = {}; } },
    customElements: { get: name => elements.get(name), define: (name, klass) => elements.set(name, klass) },
  });
  vm.runInContext(code, context);
  const Card = elements.get('powiedz-w-domu-card');
  class TestCard extends Card {
    _build() {
      this._ui = { text: node(), count: node(), mic: node(), micLabel: node(), micIcon: node(),
        help: node(), send: node(), sendLabel: node(), status: node(), composer: node(), custom: node(),
        speakers: this._config.speakers.filter(speaker => speaker.entity).map(speaker => ({ speaker, button: node(), name: node(), state: node() })),
        presets: this._config.presets.filter(preset => preset.text.trim()).map(preset => ({ button: node(), text: preset.text })) };
      this._ui.text.value = this._text;
    }
  }
  const card = new TestCard();
  const config = override || { script: 'script.powiedz_w_domu', speakers: [
    { entity: 'media_player.salon', name: 'Salon' }, { entity: 'media_player.kuchnia', name: 'Kuchnia' },
  ] };
  card.setConfig(config);
  const hass = {
    connected: true,
    states: {
      'script.powiedz_w_domu': { state: 'off', attributes: {} },
      'media_player.salon': { state: 'idle', attributes: {} },
      'media_player.kuchnia': { state: 'idle', attributes: {} },
    },
    callService: async (...args) => { calls.push(args); },
  };
  card.hass = hass;
  const text = value => { card._text = value; card._ui.text.value = value; card._update(); };
  return { card, config, hass, calls, recognitions, text, context, elements, window };
}

test('validates distinct speakers, script domain, and preset contents', () => {
  const { card, config } = setup();
  for (const bad of [
    { ...config, script: 'light.salon' },
    { ...config, speakers: [...config.speakers, { entity: 'media_player.a' }, { entity: 'media_player.b' }] },
    { ...config, speakers: [config.speakers[0], config.speakers[0]] },
    { ...config, presets: [{ text: 42 }] },
    { ...config, presets: [{ text: 'x'.repeat(1001) }] },
    { ...config, presets: Array.from({ length: 11 }, () => ({ text: 'Hej' })) },
  ]) assert.throws(() => card.setConfig(bad));
  card.setConfig({ ...config, speakers: config.speakers.slice(0, 1), presets: [] });
  assert.equal(card._config.speakers.length, 1);
  assert.equal(card._config.presets.length, 10);
  assert.equal(card._config.presets.every(preset => preset.text === ''), true);
  card.setConfig({ ...config, presets: [{ label: 'Hej' }] });
  assert.equal(card._config.presets[0].text, 'Hej');
});

test('sends exact script fields for selected speaker and retains text', async () => {
  const { card, calls, text } = setup();
  text('  Obiad gotowy!  ');
  card._selected = new Set(['media_player.kuchnia']);
  await card._send();
  assert.equal(JSON.stringify(calls), JSON.stringify([
    ['script', 'powiedz_w_domu', { tekst: 'Obiad gotowy!', glosnik: 'media_player.kuchnia' }],
  ]));
  assert.equal(card._text, '  Obiad gotowy!  ');
  assert.match(card._ui.status.textContent, /Wysłano.*Kuchnia/);
});

test('rejects empty and over-limit messages before contacting HA', async () => {
  const { card, calls, text } = setup();
  for (const value of ['', '   ', 'x'.repeat(1001)]) {
    text(value); assert.equal(card._ui.send.disabled, true); await card._send();
  }
  assert.equal(calls.length, 0);
});

test('blocks disconnected, missing script, unavailable and unknown speakers', async () => {
  for (const change of [
    h => { h.connected = false; },
    h => { delete h.states['script.powiedz_w_domu']; },
    h => { h.states['media_player.salon'].state = 'unavailable'; },
    h => { h.states['media_player.salon'].state = 'unknown'; },
  ]) {
    const { card, hass, calls, text } = setup(); text('Cześć');
    change(hass); card.hass = hass; await card._send();
    assert.equal(calls.length, 0); assert.equal(card._ui.send.disabled, true);
  }
});

test('prevents double submission while callService is pending', async () => {
  const { card, hass, text } = setup(); text('Cześć');
  let resolve, count = 0;
  hass.callService = () => { count++; return new Promise(r => { resolve = r; }); };
  const pending = card._send();
  assert.equal(card._ui.send.disabled, true);
  await card._send(); assert.equal(count, 1);
  resolve(); await pending; assert.equal(card._ui.send.disabled, false);
});

test('reports errors and allows retry without clearing text', async () => {
  const { card, hass, text } = setup(); text('Wiadomość');
  hass.callService = async () => { throw new Error('TTS niedostępny'); };
  await card._send();
  assert.match(card._ui.status.textContent, /TTS niedostępny/);
  assert.equal(card._text, 'Wiadomość'); assert.equal(card._sending, false);
  assert.equal(card._ui.send.disabled, false);
});

test('HA state refresh does not replace editor or draft', () => {
  const { card, hass, text } = setup(); text('Nie zgub mnie');
  const editor = card._ui.text;
  card.hass = { ...hass, states: { ...hass.states, 'sensor.other': { state: '10' } } };
  assert.equal(card._ui.text, editor); assert.equal(editor.value, 'Nie zgub mnie');
});

test('no speech API or insecure page disables only dictation', () => {
  for (const options of [{ secure: false }, { speech: false }]) {
    const { card, text } = setup(options); text('Tekst działa');
    assert.equal(card._ui.mic.disabled, true); assert.equal(card._ui.send.disabled, false);
    assert.ok(card._ui.help.textContent.length);
  }
});

test('interim recognition never sends or persists, final result appends once', async () => {
  const { card, recognitions, calls, text } = setup(); text('Uwaga.');
  card._toggleDictation(); const recognition = recognitions[0];
  assert.equal(recognition.lang, 'pl-PL'); assert.equal(card._ui.text.readOnly, true);
  recognition.result([['Obiad', false]]);
  assert.equal(card._ui.text.value, 'Uwaga. Obiad'); assert.equal(card._text, 'Uwaga.');
  await card._send(); assert.equal(calls.length, 0);
  recognition.result([['Obiad gotowy.', true]]);
  recognition.result([['Obiad gotowy.', true]]);
  recognition.end();
  assert.equal(card._text, 'Uwaga. Obiad gotowy.');
  assert.equal(card._ui.text.readOnly, false); assert.equal(card._ui.send.disabled, false);
});

test('stop accepts late final results and releases microphone state', () => {
  const { card, recognitions } = setup();
  card._toggleDictation(); const recognition = recognitions[0];
  card._toggleDictation(); assert.equal(recognition.stopped, true);
  recognition.result([['Dobranoc', true]]); recognition.end();
  assert.equal(card._text, 'Dobranoc'); assert.equal(card._recognition, null);
  assert.equal(card._stopping, false);
});

test('permission failure releases controls and preserves existing text', () => {
  const { card, recognitions, text } = setup(); text('Szkic');
  card._toggleDictation(); recognitions[0].error('not-allowed');
  assert.equal(card._recognition, null); assert.equal(card._ui.text.value, 'Szkic');
  assert.match(card._ui.status.textContent, /Brak dostępu/);
  assert.equal(card._ui.text.readOnly, false);
});

test('leaving the card aborts microphone and discards interim text', () => {
  const { card, recognitions, text } = setup(); text('Szkic');
  card._toggleDictation(); const recognition = recognitions[0];
  recognition.result([['tymczasowe', false]]);
  card.disconnectedCallback();
  assert.equal(recognition.aborted, true); assert.equal(recognition.onresult, null);
  card.connectedCallback();
  assert.equal(card._ui.text.value, 'Szkic'); assert.equal(card._ui.text.readOnly, false);
});

test('speech result is limited to 1000 characters', () => {
  const { card, recognitions } = setup(); card._toggleDictation();
  recognitions[0].result([['x'.repeat(1200), true]]); recognitions[0].end();
  assert.equal(card._text.length, 1000); assert.match(card._ui.status.textContent, /limit/);
});

test('reconfiguration cancels old recognition and ignores stale callbacks', () => {
  const { card, recognitions, config } = setup(); card._toggleDictation();
  const lateResult = recognitions[0].onresult;
  card.setConfig({ ...config, title: 'Nowa karta' });
  lateResult({ results: [Object.assign([{ transcript: 'stary wynik' }], { isFinal: true })] });
  assert.equal(card._text, ''); assert.equal(recognitions[0].aborted, true);
});

test('can load resource twice without duplicate custom element registration', () => {
  const { context, elements, window } = setup(); assert.doesNotThrow(() => vm.runInContext(code, context));
  assert.equal(elements.size, 5);
  assert.deepEqual(Array.from(window.customCards, card => card.type).sort(), ['ha-pomieszczenie-card', 'ha-starter-card', 'powiedz-w-domu-card']);
});

test('new card starts incomplete and asks for configuration, without throwing', async () => {
  const { card, calls } = setup({ config: {} });
  assert.equal(card._ui.send.disabled, true);
  await card._send();
  assert.match(card._ui.status.textContent, /wybierz skrypt/);
  assert.equal(calls.length, 0);
});

test('empty preset slot stays hidden and a filled one can be spoken', async () => {
  const { card, config, calls } = setup();
  card.setConfig({ ...config, presets: [{ text: '' }, { text: 'Dobranoc' }] });
  assert.equal(card._ui.presets.length, 1);
  await card._speak(card._ui.presets[0].text);
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(['script', 'powiedz_w_domu', { tekst: 'Dobranoc', glosnik: 'media_player.salon' }]));
});

test('default flag selects speakers, an empty slot is hidden, and several receive one message', async () => {
  const { card, config, calls, text } = setup();
  assert.equal(card._selected.has('media_player.salon'), true);
  assert.equal(card._selected.has('media_player.kuchnia'), false);
  card.setConfig({
    ...config,
    speakers: [
      { entity: 'media_player.salon', name: 'Salon', selected: true },
      { entity: '', name: 'Pusty' },
      { entity: 'media_player.kuchnia', name: 'Kuchnia', selected: true },
    ],
  });
  assert.equal(card._ui.speakers.length, 2);
  assert.equal(card._selected.size, 2);
  text('Cześć');
  await card._send();
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2].glosnik, 'media_player.salon');
  assert.equal(calls[1][2].glosnik, 'media_player.kuchnia');
  assert.match(card._ui.status.textContent, /Salon, Kuchnia/);
});

test('card preview blocks script calls and microphone', async () => {
  const { card, calls, text, recognitions } = setup();
  card.preview = true; text('Test'); await card._send(); card._toggleDictation();
  assert.equal(calls.length, 0); assert.equal(recognitions.length, 0);
});

test('dictation can be disabled in card configuration', () => {
  const { card, config, recognitions } = setup();
  card.setConfig({ ...config, show_dictation: false });
  assert.equal(card._ui.mic.hidden, true); card._toggleDictation();
  assert.equal(recognitions.length, 0);
});

test('editor preserves unrelated HA fields and emits complete configuration', () => {
  const { elements, config } = setup();
  const Editor = elements.get('powiedz-w-domu-editor');
  class TestEditor extends Editor {
    _render() { this.renders = (this.renders || 0) + 1; }
    dispatchEvent(event) { this.event = event; return true; }
  }
  const editor = new TestEditor();
  editor.setConfig({ ...config, type: 'custom:powiedz-w-domu-card', grid_options: { columns: 12 }, visibility: [] });
  const renders = editor.renders;
  editor._commit(c => { c.title = 'Nowy tytuł'; });
  assert.equal(editor.event.type, 'config-changed');
  assert.equal(editor.event.bubbles, true); assert.equal(editor.event.composed, true);
  assert.equal(editor.event.detail.config.title, 'Nowy tytuł');
  assert.equal(editor.event.detail.config.grid_options.columns, 12);
  editor.setConfig(editor.event.detail.config);
  assert.equal(editor.renders, renders); // Configuration echo must not steal input focus.
});

test('editor keeps three speaker slots and ten message slots without mutating input', () => {
  const { elements } = setup();
  const Editor = elements.get('powiedz-w-domu-editor');
  class TestEditor extends Editor { _render() {} dispatchEvent() { return true; } }
  const editor = new TestEditor();
  const input = {
    script: 'script.powiedz_w_domu',
    speakers: [{ entity: 'media_player.salon', name: 'Salon' }],
    presets: [{ label: 'Pierwszy', text: 'A' }],
  };
  editor.setConfig(input);
  assert.equal(editor._config.speakers.length, 3);
  assert.equal(editor._config.speakers[0].selected, true);
  assert.equal(editor._config.speakers[1].entity, '');
  assert.equal(editor._config.presets.length, 10);
  assert.equal(editor._config.presets[0].text, 'A');
  assert.equal(editor._config.presets[1].text, '');
  editor._commit(c => { c.speakers[1].entity = 'media_player.kuchnia'; c.speakers[1].selected = true; c.presets[1].text = 'B'; });
  assert.equal(input.speakers.length, 1);
  assert.equal(input.presets.length, 1);
  assert.equal(editor._config.presets[1].text, 'B');
  assert.equal(editor._config.speakers[1].selected, true);
});
