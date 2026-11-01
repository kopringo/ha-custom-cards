const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '..', 'dist', 'ha-custom-cards.js'), 'utf8');

class HTMLElement {
  constructor() {
    this.children = [];
    this.attrs = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.className = '';
    this._listeners = {};
    const el = this;
    this.classList = {
      toggle(name, force) {
        const names = new Set(String(el.className || '').split(/\s+/).filter(Boolean));
        const on = force === undefined ? !names.has(name) : !!force;
        if (on) names.add(name); else names.delete(name);
        el.className = [...names].join(' ');
        return on;
      },
      contains(name) { return String(el.className || '').split(/\s+/).includes(name); },
    };
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  removeAttribute(name) { delete this.attrs[name]; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  click() { for (const fn of this._listeners.click || []) fn({}); }
  attachShadow() { this.shadowRoot = new HTMLElement(); return this.shadowRoot; }
}

function setup(override) {
  const elements = new Map();
  const document = {
    createElement(tag) {
      const element = new HTMLElement();
      element.tagName = String(tag).toUpperCase();
      return element;
    },
  };
  const context = vm.createContext({
    window: {}, document, HTMLElement, CustomEvent, setTimeout, clearTimeout,
    customElements: { get: name => elements.get(name), define: (name, value) => elements.set(name, value) },
  });
  vm.runInContext(code, context);
  const Card = elements.get('ha-pomieszczenie-card');
  const card = new Card();
  const config = override || {
    name: 'Salon',
    climate: 'climate.salon',
    thermometer: 'sensor.salon_temperatura',
    plug: 'switch.gniazdko_salon',
    power: 'sensor.gniazdko_salon_moc',
    lights: [
      { entity: 'light.salon_glowna', name: 'Główne', icon: 'mdi:ceiling-light' },
      { entity: 'light.salon_kinkiet', name: 'Kinkiet', icon: 'mdi:floor-lamp' },
      { entity: '', name: '', icon: 'mdi:lightbulb-outline' },
    ],
  };
  card.setConfig(config);
  const hass = {
    connected: true,
    states: {
      'climate.salon': {
        state: 'heat',
        attributes: {
          friendly_name: 'Termostat salonu', temperature: 21.5, current_temperature: 20.8,
          min_temp: 5, max_temp: 30, target_temp_step: 0.5, temperature_unit: '°C',
          hvac_modes: ['off', 'heat', 'auto'], hvac_action: 'heating',
        },
      },
      'sensor.salon_temperatura': { state: '21.4', attributes: { friendly_name: 'Temperatura salonu', unit_of_measurement: '°C', device_class: 'temperature' } },
      'switch.gniazdko_salon': { state: 'on', attributes: { friendly_name: 'Gniazdko salonu' } },
      'sensor.gniazdko_salon_moc': { state: '86.2', attributes: { friendly_name: 'Moc gniazdka', unit_of_measurement: 'W', device_class: 'power' } },
      'light.salon_glowna': { state: 'on', attributes: { friendly_name: 'Lampa główna' } },
      'light.salon_kinkiet': { state: 'off', attributes: { friendly_name: 'Kinkiet' } },
    },
    callService: async (...args) => { hass.calls.push(args); },
  };
  hass.calls = [];
  card.hass = hass;
  return { card, config, hass, elements, context };
}

test('rejects bad domains, too many lights and duplicates without replacing a valid config', () => {
  const { card, config } = setup();
  for (const bad of [
    { ...config, climate: 'switch.salon' },
    { ...config, thermometer: 'climate.salon' },
    { ...config, plug: 'light.salon' },
    { ...config, power: 'switch.salon' },
    { ...config, lights: [...config.lights, { entity: 'light.czwarte' }] },
    { ...config, lights: [{ entity: 'light.salon_glowna' }, { entity: 'light.salon_glowna' }] },
    { ...config, lights: 'light.salon' },
    { ...config, lights: ['light.salon'] },
  ]) assert.throws(() => card.setConfig(bad));
  assert.equal(card._config.climate, 'climate.salon');
  assert.equal(card._ui.lightButtons.length, 2);
});

test('shows room name, temperatures, plug power and only selected lights', () => {
  const { card } = setup();
  assert.equal(card._ui.name.textContent, 'Salon');
  assert.equal(card._ui.thermometerValue.textContent, '21,4');
  assert.equal(card._ui.thermometerUnit.textContent, '°C');
  assert.equal(card._ui.targetValue.textContent, '21,5');
  assert.equal(card._ui.action.textContent, 'Grzeje');
  assert.equal(card._ui.plug.tagName, 'DIV');
  assert.equal(card._ui.plugState.textContent, 'Włączone');
  assert.equal(card._ui.plugPower.textContent, '86,2 W');
  assert.equal(card._ui.plug.classList.contains('on'), true);
  assert.equal(card._ui.lightButtons.length, 2);
  assert.equal(card._ui.lightButtons[0].label.textContent, 'Główne');
  assert.equal(card._ui.lightButtons[0].button.getAttribute('aria-pressed'), 'true');
  assert.equal(card._ui.lightButtons[1].button.getAttribute('aria-pressed'), 'false');
  assert.equal(card._ui.modeButtons.map(item => item.mode).join(','), 'off,heat,auto');
  assert.equal(card._ui.empty.hidden, true);
});

test('plug is not a control and reads power from the plug when no sensor is set', async () => {
  const { card, hass } = setup();
  card._ui.plug.click();
  assert.equal(hass.calls.length, 0);
  assert.equal(card._ui.plug._listeners.click, undefined);
  card.setConfig({ name: 'Salon', plug: 'switch.gniazdko_salon' });
  hass.states['switch.gniazdko_salon'].attributes.current_power_w = 12.5;
  card.hass = hass;
  assert.equal(card._ui.plugState.textContent, 'Włączone');
  assert.equal(card._ui.plugPower.textContent, '12,5 W');
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'src', 'cards', 'pomieszczenie', 'card.js'), 'utf8'), /callService\(\s*["']switch["']/);
});

test('steps the setpoint, clamps the minimum and queues a second tap', async () => {
  const { card, hass } = setup();
  const pending = [];
  hass.callService = (...args) => { hass.calls.push(args); return new Promise(resolve => pending.push(resolve)); };
  const first = card._nudge(1);
  await Promise.resolve();
  assert.equal(hass.calls[0][2].temperature, 22);
  assert.equal(card._ui.targetValue.textContent, '22');
  card._nudge(1);
  assert.equal(card._pendingTemp, 22.5);
  pending[0]();
  for (let attempt = 0; attempt < 5 && hass.calls.length < 2; attempt += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(hass.calls[1][2].temperature, 22.5);
  pending[1]();
  await first;
  hass.states['climate.salon'].attributes.temperature = 22.5;
  card.hass = hass;
  assert.equal(card._pendingTemp, null);
  hass.states['climate.salon'].attributes.temperature = 5;
  card.hass = hass;
  await card._nudge(-1);
  assert.equal(hass.calls.length, 2);
  assert.equal(card._ui.minus.disabled, true);
  hass.states['climate.salon'].attributes.target_temp_step = 0.1;
  assert.equal(card._round(0.1 + 0.2), 0.3);
});

test('changes climate mode and toggles only a selected light', async () => {
  const { card, hass } = setup();
  await card._setMode('heat');
  assert.equal(hass.calls.length, 0);
  await card._setMode('off');
  assert.equal(JSON.stringify(hass.calls[0]), JSON.stringify(['climate', 'set_hvac_mode', { entity_id: 'climate.salon', hvac_mode: 'off' }]));
  await card._toggleLight('light.salon_glowna');
  assert.equal(JSON.stringify(hass.calls[1]), JSON.stringify(['light', 'toggle', { entity_id: 'light.salon_glowna' }]));
  assert.equal(card._ui.lightButtons[0].button.getAttribute('aria-pressed'), 'false');
  const button = card._ui.lightButtons[0].button;
  hass.states['sensor.salon_temperatura'].state = '19.2';
  card.hass = hass;
  assert.equal(card._ui.thermometerValue.textContent, '19,2');
  assert.equal(card._ui.lightButtons[0].button, button);
});

test('failed light toggle restores the previous state', async () => {
  const { card, hass } = setup();
  hass.callService = async () => { throw new Error('Światło niedostępne'); };
  await card._toggleLight('light.salon_glowna');
  assert.equal(card._ui.lightButtons[0].button.getAttribute('aria-pressed'), 'true');
  assert.match(card._ui.status.textContent, /Światło niedostępne/);
  assert.equal(card._lightFlight.size, 0);
});

test('preview, disconnect and unavailable climate do not call services', async () => {
  const { card, hass } = setup();
  card.preview = true;
  await card._nudge(1);
  await card._setMode('off');
  await card._toggleLight('light.salon_kinkiet');
  card.preview = false;
  hass.connected = false;
  card.hass = hass;
  await card._nudge(1);
  assert.equal(hass.calls.length, 0);
  assert.equal(card._ui.plus.disabled, true);
  assert.match(card._ui.status.textContent, /Brak połączenia/);
  hass.connected = true;
  hass.states['climate.salon'].state = 'unavailable';
  card.hass = hass;
  await card._nudge(1);
  assert.equal(hass.calls.length, 0);
  assert.equal(card._ui.action.textContent, 'Niedostępny');
});

test('empty slots stay in config but a new card asks for entities', () => {
  const { card } = setup({ lights: [{ entity: 'light.lampa', name: '' }] });
  assert.equal(card._config.lights.length, 3);
  assert.equal(card._config.lights[0].icon, 'mdi:ceiling-light');
  assert.equal(card._ui.lightButtons.length, 1);
  assert.equal(card._ui.lightButtons[0].label.textContent, 'light.lampa');
  card.setConfig({});
  assert.equal(card._ui.name.textContent, 'Pomieszczenie');
  assert.equal(card._ui.empty.hidden, false);
  assert.equal(card._ui.lightButtons.length, 0);
  assert.equal(card._ui.plug.hidden, true);
});

test('incoming light config is copied, not reused', () => {
  const { card } = setup({});
  const lights = [{ entity: 'light.lampa' }];
  card.setConfig({ lights });
  lights[0].entity = 'light.inne';
  assert.equal(card._config.lights[0].entity, 'light.lampa');
});

test('editor keeps unrelated HA fields and ignores an echoed config', () => {
  const { elements } = setup();
  const Editor = elements.get('ha-pomieszczenie-editor');
  class TestEditor extends Editor {
    _render() { this.renders = (this.renders || 0) + 1; }
    dispatchEvent(event) { this.event = event; return true; }
  }
  const editor = new TestEditor();
  editor.setConfig({
    name: 'Salon', type: 'custom:ha-pomieszczenie-card',
    grid_options: { columns: 6 }, visibility: [],
    lights: [{ entity: 'light.salon_glowna', name: 'Główne' }],
  });
  const renders = editor.renders;
  editor._commit(config => { config.name = 'Kuchnia'; });
  assert.equal(editor.event.detail.config.name, 'Kuchnia');
  assert.equal(editor.event.detail.config.grid_options.columns, 6);
  assert.equal(JSON.stringify(editor.event.detail.config.visibility), '[]');
  assert.equal(editor.event.detail.config.lights.length, 3);
  assert.equal(editor.event.detail.config.lights[0].entity, 'light.salon_glowna');
  assert.equal(editor.event.bubbles, true);
  editor.setConfig(editor.event.detail.config);
  assert.equal(editor.renders, renders);
});
