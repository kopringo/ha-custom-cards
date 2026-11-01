/** ha-custom-cards v1.0.0 | MIT | Generated: edit src/, not dist/. */
(() => {
'use strict';
// Source: src/shared/kit.js
// Shared inside the bundle's closure; no globals, imports or CDN dependencies.
const HaCardKit = Object.freeze({
  register(type, element, metadata) {
    if (!customElements.get(type)) customElements.define(type, element);
    window.customCards = window.customCards || [];
    if (!window.customCards.some(card => card.type === type)) {
      window.customCards.push({ type, preview: true, ...metadata });
    }
  },
  clone(value) { return JSON.parse(JSON.stringify(value)); },
});
;

// Source: src/cards/blank/card.js
// Copy this folder, or run: npm run new:card -- moja-karta "Moja karta"
(() => {
  const TAG = "ha-starter-card";

  class StarterCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }

    static getStubConfig() { return { title: "Pusta karta", height: 160 }; }
    static getConfigForm() {
      return {
        schema: [
          { name: "title", selector: { text: {} } },
          { name: "height", selector: { number: { min: 80, max: 600, step: 10, mode: "box", unit_of_measurement: "px" } } },
        ],
        computeLabel: field => ({ title: "Tytuł", height: "Wysokość" })[field.name],
      };
    }

    setConfig(config) {
      const height = Number(config.height ?? 160);
      if (!Number.isFinite(height) || height < 80 || height > 600) {
        throw new Error("Wysokość musi wynosić od 80 do 600 px.");
      }
      this._config = { ...config, title: String(config.title ?? "Pusta karta"), height };
      this._render();
    }

    // Access entities via this._hass.states[entityId] in your own card.
    // Update only changing nodes here; do not rebuild inputs on every state change.
    set hass(value) { this._hass = value; }
    get hass() { return this._hass; }
    getCardSize() { return Math.ceil((this._config?.height ?? 160) / 50); }
    getGridOptions() { return { columns: 12, rows: "auto" }; }

    _render() {
      if (!this._config) return;
      if (!this._surface) {
        this.shadowRoot.innerHTML = `
          <style>
            :host { display:block; }
            ha-card { box-sizing:border-box; padding:20px; color:var(--primary-text-color); }
            h2 { margin:0; font:500 20px/1.4 var(--paper-font-body1_-_font-family, sans-serif); overflow-wrap:anywhere; }
          </style>
          <ha-card><h2></h2><div class="content"></div></ha-card>`;
        this._surface = this.shadowRoot.querySelector("ha-card");
        this._title = this.shadowRoot.querySelector("h2");
        this._content = this.shadowRoot.querySelector(".content");
      }
      this._surface.style.minHeight = `${this._config.height}px`;
      this._title.textContent = this._config.title;
      this._title.hidden = !this._config.title;
      // Add your UI to this._content. Keep user/config text in textContent.
    }
  }

  HaCardKit.register(TAG, StarterCard, {
    name: "Pusta karta",
    description: "Pusty szablon do tworzenia własnych kart.",
  });
})();
;

// Source: src/cards/pomieszczenie/card.js
/** Karta pomieszczenia — termostat, termometr, odczyt gniazdka i do trzech świateł. */
(() => {
  const TAG = "ha-pomieszczenie-card";
  if (customElements.get(TAG)) return;

  const ID = {
    climate: /^climate\.[a-z0-9_]+$/,
    sensor: /^sensor\.[a-z0-9_]+$/,
    switch: /^switch\.[a-z0-9_]+$/,
    light: /^(?:light|switch)\.[a-z0-9_]+$/,
  };
  const LIGHTS = 3;
  const DEFAULT_ICONS = ["mdi:ceiling-light", "mdi:floor-lamp", "mdi:lightbulb-outline"];
  const HVAC_LABEL = {
    off: "Wył.", heat: "Grzanie", cool: "Chłód", heat_cool: "Auto",
    auto: "Auto", dry: "Osuszanie", fan_only: "Wentylator",
  };
  const ACTION_LABEL = {
    heating: "Grzeje", cooling: "Chłodzi", idle: "Bezczynny", off: "Wyłączony",
    drying: "Osusza", fan: "Nawiew", preheating: "Nagrzewa", defrosting: "Odszrania",
  };

  const setHidden = (element, hidden) => {
    element.hidden = hidden;
    if (hidden) element.setAttribute("hidden", "");
    else element.removeAttribute("hidden");
  };

  class PomieszczenieCard extends HTMLElement {
    static getConfigElement() {
      return document.createElement("ha-pomieszczenie-editor");
    }

    static getStubConfig() {
      return {
        name: "Pomieszczenie",
        climate: "",
        thermometer: "",
        plug: "",
        power: "",
        lights: DEFAULT_ICONS.map(icon => ({ entity: "", name: "", icon })),
      };
    }

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._revision = 0;
      this._notice = "";
      this._noticeError = false;
      this._pendingTemp = null;
      this._tempDesired = null;
      this._tempFlight = false;
      this._pendingMode = null;
      this._modeFlight = false;
      this._modeSignature = "";
      this._lightOverride = new Map();
      this._lightFlight = new Set();
      this._timers = {};
      this._tokens = {};
    }

    setConfig(config) {
      const next = this._normalize(config || {});
      this._revision += 1;
      this._notice = "";
      this._noticeError = false;
      this._pendingTemp = null;
      this._tempDesired = null;
      this._tempFlight = false;
      this._pendingMode = null;
      this._modeFlight = false;
      this._lightOverride = new Map();
      this._lightFlight = new Set();
      for (const timer of Object.values(this._timers)) clearTimeout(timer);
      this._timers = {};
      this._tokens = {};
      this._config = next;
      this._build();
      this._update();
    }

    set hass(value) {
      this._hass = value;
      if (!this._config || !this._ui) return;
      this._reconcile();
      this._update();
    }

    get hass() { return this._hass; }

    connectedCallback() { if (this._config && this._ui) this._update(); }

    disconnectedCallback() {
      for (const timer of Object.values(this._timers)) clearTimeout(timer);
    }

    getCardSize() {
      const config = this._config;
      if (!config) return 4;
      let rows = 2;
      if (config.thermometer || config.climate) rows += 2;
      if (config.plug || config.power) rows += 1;
      if (config.lights.some(light => light.entity)) rows += 1;
      return rows;
    }

    getGridOptions() { return { columns: 6, rows: "auto", min_columns: 3 }; }

    _normalize(config) {
      const entity = (value, pattern, message) => {
        if (value == null || value === "") return "";
        const id = String(value);
        if (!pattern.test(id)) throw new Error(message);
        return id;
      };
      if (config.lights != null && !Array.isArray(config.lights)) {
        throw new Error("Pole lights musi być listą.");
      }
      if (Array.isArray(config.lights) && config.lights.length > LIGHTS) {
        throw new Error("Możesz skonfigurować maksymalnie 3 światła.");
      }
      const lights = Array.from({ length: LIGHTS }, (_, index) => {
        const item = config.lights?.[index] || {};
        if (item == null || typeof item !== "object" || Array.isArray(item)) {
          throw new Error("Każde światło musi być obiektem z polem entity.");
        }
        return {
          entity: entity(item.entity, ID.light, "Światło musi być encją light albo switch."),
          name: String(item.name || "").trim().slice(0, 60),
          icon: String(item.icon || DEFAULT_ICONS[index]).trim().slice(0, 80) || DEFAULT_ICONS[index],
        };
      });
      const chosen = lights.map(light => light.entity).filter(Boolean);
      if (new Set(chosen).size !== chosen.length) throw new Error("Każde światło musi być inną encją.");
      return {
        name: String(config.name ?? "").trim().slice(0, 80) || "Pomieszczenie",
        climate: entity(config.climate, ID.climate, "Termostat musi być encją climate."),
        thermometer: entity(config.thermometer, ID.sensor, "Termometr musi być encją sensor."),
        plug: entity(config.plug, ID.switch, "Gniazdko musi być encją switch."),
        power: entity(config.power, ID.sensor, "Czujnik mocy musi być encją sensor."),
        lights,
      };
    }

    _build() {
      const style = document.createElement("style");
      style.textContent = `
        :host { display: block; color: var(--primary-text-color); }
        * { box-sizing: border-box; }
        ha-card { container-type: inline-size; display: block; padding: 16px; }
        h2 { margin: 0 0 14px; font-size: 22px; font-weight: 600; line-height: 1.2; letter-spacing: -0.02em; overflow-wrap: anywhere; }
        .stack { display: flex; flex-direction: column; gap: 10px; }
        .metrics { display: grid; grid-template-columns: 1fr; gap: 10px; }
        .tile { min-width: 0; display: flex; flex-direction: column; padding: 14px; border-radius: 16px; background: var(--secondary-background-color); }
        .thermometer .sub { margin-top: auto; padding-top: 8px; }
        .kicker { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--secondary-text-color); }
        .thermo-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .reading { margin: 10px 0 0; font-size: 34px; font-weight: 500; line-height: 1; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }
        .unit { margin-left: 2px; font-size: 15px; font-weight: 500; letter-spacing: 0; }
        .sub { margin: 8px 0 0; min-height: 16px; font-size: 12px; color: var(--secondary-text-color); overflow-wrap: anywhere; }
        .action { margin: 0; font-size: 12px; font-weight: 500; color: var(--secondary-text-color); text-align: right; }
        .action.heat { color: var(--state-climate-heat-color, var(--primary-color)); }
        .action.cool { color: var(--state-climate-cool-color, var(--primary-color)); }
        button { font: inherit; touch-action: manipulation; }
        .stepper { display: flex; gap: 8px; margin-top: 12px; }
        .stepper button, .mode, .light {
          color: var(--primary-text-color);
          background: var(--card-background-color);
          border: 1px solid var(--divider-color);
          cursor: pointer;
        }
        .stepper button { width: 44px; height: 44px; border-radius: 14px; font-size: 22px; line-height: 1; }
        .modes { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .mode { min-height: 32px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; }
        .mode[aria-pressed="true"], .light[aria-pressed="true"] {
          background: var(--primary-color);
          border-color: transparent;
          color: var(--text-primary-color, #fff);
        }
        .plug { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 12px 14px; border-radius: 16px; background: var(--secondary-background-color); }
        .plug-icon { display: grid; place-items: center; width: 40px; height: 40px; flex: none; border-radius: 12px; background: var(--card-background-color); color: var(--secondary-text-color); }
        .plug.on .plug-icon { color: var(--primary-color); }
        .plug-copy { min-width: 0; flex: 1; }
        .plug-name { margin: 0; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
        .plug-state { margin: 2px 0 0; font-size: 12px; color: var(--secondary-text-color); }
        .plug-state::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: var(--secondary-text-color); transform: translateY(-1px); }
        .plug.on .plug-state::before { background: var(--primary-color); }
        .plug-power { margin: 0; font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .lights { display: flex; flex-wrap: wrap; gap: 8px; }
        .light { display: flex; flex: 1 1 140px; align-items: center; justify-content: center; gap: 8px; min-width: 0; min-height: 48px; padding: 8px 12px; border-radius: 14px; background: var(--secondary-background-color); }
        .light span { overflow-wrap: anywhere; }
        .empty, .status { margin: 0; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; color: var(--secondary-text-color); }
        .status.error { color: var(--error-color); }
        button:disabled { cursor: default; opacity: 0.45; }
        button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
        [hidden] { display: none !important; }
        ha-icon { --mdc-icon-size: 22px; }
        .light ha-icon { --mdc-icon-size: 20px; }
        @container (min-width: 440px) {
          .metrics:not(.single) { grid-template-columns: 1fr 1fr; }
        }
      `;
      const card = document.createElement("ha-card");
      const name = document.createElement("h2");
      const stack = document.createElement("div");
      stack.className = "stack";
      const empty = document.createElement("p");
      empty.className = "empty";
      const metrics = document.createElement("div");
      metrics.className = "metrics";
      const thermometer = document.createElement("section");
      thermometer.className = "tile thermometer";
      const thermometerKicker = document.createElement("p");
      thermometerKicker.className = "kicker";
      thermometerKicker.textContent = "Termometr";
      const thermometerReading = document.createElement("p");
      thermometerReading.className = "reading";
      const thermometerValue = document.createElement("span");
      const thermometerUnit = document.createElement("span");
      thermometerUnit.className = "unit";
      thermometerReading.append(thermometerValue, thermometerUnit);
      const thermometerSub = document.createElement("p");
      thermometerSub.className = "sub";
      thermometer.append(thermometerKicker, thermometerReading, thermometerSub);

      const thermostat = document.createElement("section");
      thermostat.className = "tile thermostat";
      const thermoTop = document.createElement("div");
      thermoTop.className = "thermo-top";
      const thermostatKicker = document.createElement("p");
      thermostatKicker.className = "kicker";
      thermostatKicker.textContent = "Zadana";
      const action = document.createElement("p");
      action.className = "action";
      thermoTop.append(thermostatKicker, action);
      const targetReading = document.createElement("p");
      targetReading.className = "reading";
      const targetValue = document.createElement("span");
      const targetUnit = document.createElement("span");
      targetUnit.className = "unit";
      targetReading.append(targetValue, targetUnit);
      const stepper = document.createElement("div");
      stepper.className = "stepper";
      const minus = document.createElement("button");
      minus.type = "button";
      minus.textContent = "−";
      minus.setAttribute("aria-label", "Obniż temperaturę zadaną");
      minus.addEventListener("click", () => this._nudge(-1));
      const plus = document.createElement("button");
      plus.type = "button";
      plus.textContent = "+";
      plus.setAttribute("aria-label", "Podnieś temperaturę zadaną");
      plus.addEventListener("click", () => this._nudge(1));
      stepper.append(minus, plus);
      const modes = document.createElement("div");
      modes.className = "modes";
      modes.setAttribute("role", "group");
      modes.setAttribute("aria-label", "Tryb termostatu");
      thermostat.append(thermoTop, targetReading, stepper, modes);
      metrics.append(thermometer, thermostat);

      // Read-only on purpose: the plug reports state and power, it is not a switch.
      const plug = document.createElement("div");
      plug.className = "plug";
      plug.setAttribute("role", "group");
      const plugIconWrap = document.createElement("div");
      plugIconWrap.className = "plug-icon";
      const plugIcon = document.createElement("ha-icon");
      plugIcon.setAttribute("icon", "mdi:power-plug");
      plugIcon.setAttribute("aria-hidden", "true");
      plugIconWrap.append(plugIcon);
      const plugCopy = document.createElement("div");
      plugCopy.className = "plug-copy";
      const plugName = document.createElement("p");
      plugName.className = "plug-name";
      const plugState = document.createElement("p");
      plugState.className = "plug-state";
      plugCopy.append(plugName, plugState);
      const plugPower = document.createElement("p");
      plugPower.className = "plug-power";
      plug.append(plugIconWrap, plugCopy, plugPower);

      const lights = document.createElement("div");
      lights.className = "lights";
      lights.setAttribute("role", "group");
      lights.setAttribute("aria-label", "Światła");
      const lightButtons = [];
      for (const light of this._config.lights.filter(item => item.entity)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "light";
        const icon = document.createElement("ha-icon");
        icon.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        button.append(icon, label);
        button.addEventListener("click", () => this._toggleLight(light.entity));
        lights.append(button);
        lightButtons.push({ button, icon, label, entity: light.entity });
      }

      const status = document.createElement("p");
      status.className = "status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      stack.append(empty, metrics, plug, lights, status);
      card.append(name, stack);
      this.shadowRoot.replaceChildren(style, card);
      this._modeSignature = "";
      this._ui = {
        name, empty, metrics, thermometer, thermometerValue, thermometerUnit, thermometerSub,
        thermostat, action, targetValue, targetUnit, minus, plus, modes, modeButtons: [],
        plug, plugName, plugState, plugPower, lights, lightButtons, status,
      };
    }

    _update() {
      if (!this._ui || !this._config) return;
      const ui = this._ui;
      ui.name.textContent = this._config.name;
      const showThermometer = !!this._config.thermometer;
      const showThermostat = !!this._config.climate;
      const showPlug = !!(this._config.plug || this._config.power);
      const showLights = ui.lightButtons.length > 0;
      const configured = showThermometer || showThermostat || showPlug || showLights;
      setHidden(ui.empty, configured);
      ui.empty.textContent = "Wybierz encje w konfiguracji karty.";
      setHidden(ui.metrics, !showThermometer && !showThermostat);
      setHidden(ui.thermometer, !showThermometer);
      setHidden(ui.thermostat, !showThermostat);
      ui.metrics.className = "metrics";
      ui.metrics.classList.toggle("single", showThermometer !== showThermostat);

      if (showThermometer) this._updateThermometer();
      if (showThermostat) this._updateThermostat();
      else setHidden(ui.modes, true);
      this._updatePlug(showPlug);
      this._updateLights();
      setHidden(ui.lights, !showLights);

      const offline = !this.preview && this._hass?.connected === false && configured;
      const status = this._notice || (offline ? "Brak połączenia z Home Assistant." : "");
      ui.status.textContent = status;
      ui.status.className = this._notice && this._noticeError ? "status error" : "status";
      setHidden(ui.status, !status);
    }

    _updateThermometer() {
      const ui = this._ui;
      const entity = this._config.thermometer;
      const unavailable = this._unavailable(entity);
      this._setReading(ui.thermometerValue, ui.thermometerUnit, unavailable ? null : this._numericState(entity), this._unit(entity));
      const name = this._friendly(entity, "");
      ui.thermometerSub.textContent = unavailable ? "Niedostępny" : name;
      ui.thermometer.setAttribute("aria-label", unavailable
        ? "Termometr niedostępny"
        : `Termometr ${ui.thermometerValue.textContent} ${ui.thermometerUnit.textContent}`.trim());
    }

    _updateThermostat() {
      const ui = this._ui;
      const unavailable = this._unavailable(this._config.climate);
      const range = this._rangeTarget();
      const target = this._displayedTarget();
      if (target != null) this._setReading(ui.targetValue, ui.targetUnit, target, this._unit(this._config.climate));
      else if (range) {
        ui.targetValue.textContent = `${this._formatNumber(range.low, this._digits())}–${this._formatNumber(range.high, this._digits())}`;
        ui.targetUnit.textContent = this._unit(this._config.climate);
      } else this._setReading(ui.targetValue, ui.targetUnit, null, "");
      const action = this._action();
      ui.action.textContent = unavailable ? "Niedostępny" : action.label;
      ui.action.className = "action";
      if (!unavailable && action.kind) ui.action.classList.toggle(action.kind, true);
      const { min, max } = this._bounds();
      ui.minus.disabled = !this._canAdjustTemp() || target == null || target <= min + 0.001;
      ui.plus.disabled = !this._canAdjustTemp() || target == null || target >= max - 0.001;
      ui.thermostat.setAttribute("aria-label", `Temperatura zadana ${ui.targetValue.textContent} ${ui.targetUnit.textContent}`.trim());
      this._syncModes(unavailable);
    }

    _syncModes(unavailable) {
      const modes = unavailable ? [] : this._hvacModes();
      const signature = modes.join("\0");
      if (signature !== this._modeSignature) {
        this._modeSignature = signature;
        this._ui.modes.replaceChildren();
        this._ui.modeButtons = modes.map(mode => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "mode";
          button.addEventListener("click", () => this._setMode(mode));
          this._ui.modes.append(button);
          return { button, mode };
        });
      }
      const current = this._currentMode();
      for (const item of this._ui.modeButtons) {
        item.button.textContent = HVAC_LABEL[item.mode] || item.mode;
        item.button.setAttribute("aria-pressed", String(item.mode === current));
        item.button.disabled = !this._canControlClimate() || this._modeFlight;
      }
      setHidden(this._ui.modes, !this._ui.modeButtons.length);
    }

    _updatePlug(show) {
      const ui = this._ui;
      setHidden(ui.plug, !show);
      if (!show) return;
      const entity = this._config.plug;
      const unavailable = entity ? this._unavailable(entity) : false;
      const on = !!entity && !unavailable && this._state(entity)?.state === "on";
      ui.plug.className = "plug";
      ui.plug.classList.toggle("on", on);
      ui.plugName.textContent = this._friendly(entity || this._config.power, "Gniazdko");
      ui.plugState.textContent = !entity ? "Pobór mocy" : unavailable ? "Niedostępne" : on ? "Włączone" : "Wyłączone";
      const power = this._powerReading();
      ui.plugPower.textContent = power || "";
      setHidden(ui.plugPower, !power);
      ui.plug.setAttribute("aria-label", [ui.plugName.textContent, ui.plugState.textContent, power].filter(Boolean).join(", "));
    }

    _updateLights() {
      for (const item of this._ui.lightButtons) {
        const on = this._lightOn(item.entity);
        const unavailable = this._unavailable(item.entity);
        const light = this._config.lights.find(entry => entry.entity === item.entity);
        item.button.setAttribute("aria-pressed", String(on));
        item.button.disabled = !this._interactive() || unavailable || this._lightFlight.has(item.entity);
        item.icon.setAttribute("icon", light?.icon || "mdi:lightbulb");
        item.label.textContent = this._lightName(light);
      }
    }

    _reconcile() {
      if (this._same(this._entityTarget(), this._pendingTemp)) this._pendingTemp = null;
      const actualMode = this._entityMode();
      if (this._pendingMode && actualMode === this._pendingMode) this._pendingMode = null;
      for (const [entity, expected] of this._lightOverride) {
        if (this._state(entity)?.state === (expected ? "on" : "off")) this._lightOverride.delete(entity);
      }
    }

    async _nudge(direction) {
      if (!this._canAdjustTemp()) return;
      const current = this._displayedTarget();
      if (current == null) return;
      const next = this._clamp(this._round(current + direction * this._step()));
      if (this._same(next, current)) return;
      this._pendingTemp = next;
      this._tempDesired = next;
      this._clearNotice();
      this._watch("temp", () => { this._pendingTemp = null; });
      this._update();
      if (this._tempFlight) return;
      this._tempFlight = true;
      const revision = this._revision;
      try {
        while (this._tempDesired != null && revision === this._revision) {
          const temperature = this._tempDesired;
          this._tempDesired = null;
          await this._hass.callService("climate", "set_temperature", {
            entity_id: this._config.climate,
            temperature,
          });
        }
      } catch (error) {
        if (revision === this._revision) {
          this._tempDesired = null;
          this._pendingTemp = null;
          this._fail(`Nie udało się zmienić temperatury. ${this._errorText(error)}`);
        }
      } finally {
        this._tempFlight = false;
        if (revision === this._revision) this._update();
      }
    }

    async _setMode(mode) {
      if (!this._canControlClimate() || this._modeFlight || this._currentMode() === mode) return;
      this._modeFlight = true;
      this._pendingMode = mode;
      this._clearNotice();
      this._watch("mode", () => { this._pendingMode = null; });
      this._update();
      const revision = this._revision;
      try {
        await this._hass.callService("climate", "set_hvac_mode", {
          entity_id: this._config.climate,
          hvac_mode: mode,
        });
      } catch (error) {
        if (revision === this._revision) {
          this._pendingMode = null;
          this._fail(`Nie udało się zmienić trybu. ${this._errorText(error)}`);
        }
      } finally {
        this._modeFlight = false;
        if (revision === this._revision) this._update();
      }
    }

    async _toggleLight(entity) {
      if (!this._interactive() || this._unavailable(entity) || this._lightFlight.has(entity)) return;
      if (!this._config.lights.some(light => light.entity === entity)) return;
      const next = !this._lightOn(entity);
      this._lightFlight.add(entity);
      this._lightOverride.set(entity, next);
      this._clearNotice();
      this._watch(`light:${entity}`, () => { this._lightOverride.delete(entity); });
      this._update();
      const revision = this._revision;
      try {
        await this._hass.callService(entity.split(".")[0], "toggle", { entity_id: entity });
      } catch (error) {
        if (revision === this._revision) {
          this._lightOverride.delete(entity);
          this._fail(`Nie udało się przełączyć światła. ${this._errorText(error)}`);
        }
      } finally {
        this._lightFlight.delete(entity);
        if (revision === this._revision) this._update();
      }
    }

    _watch(key, clear) {
      const token = (this._tokens[key] || 0) + 1;
      this._tokens[key] = token;
      clearTimeout(this._timers[key]);
      const timer = setTimeout(() => {
        if (this._tokens[key] !== token || !this.isConnected) return;
        clear();
        this._update();
      }, 8000);
      if (timer && typeof timer.unref === "function") timer.unref();
      this._timers[key] = timer;
    }

    _interactive() {
      return !this.preview && !!this._hass && this._hass.connected !== false && typeof this._hass.callService === "function";
    }

    _canControlClimate() {
      return this._interactive() && !!this._config?.climate && !this._unavailable(this._config.climate);
    }

    _canAdjustTemp() {
      return this._canControlClimate() && this._displayedTarget() != null;
    }

    _state(entity) { return entity ? this._hass?.states?.[entity] : undefined; }

    _unavailable(entity) {
      const state = this._state(entity)?.state;
      return !state || state === "unavailable" || state === "unknown";
    }

    _friendly(entity, fallback) {
      return this._state(entity)?.attributes?.friendly_name || fallback;
    }

    _lightName(light) {
      return light?.name || this._friendly(light?.entity, light?.entity || "Światło");
    }

    _lightOn(entity) {
      if (this._lightOverride.has(entity)) return this._lightOverride.get(entity);
      return this._state(entity)?.state === "on";
    }

    _entityTarget() {
      const value = Number(this._state(this._config.climate)?.attributes?.temperature);
      return Number.isFinite(value) ? value : null;
    }

    _displayedTarget() {
      if (this._pendingTemp != null) return this._pendingTemp;
      const value = this._entityTarget();
      return value == null ? null : this._round(value);
    }

    _rangeTarget() {
      const attributes = this._state(this._config.climate)?.attributes || {};
      const low = Number(attributes.target_temp_low);
      const high = Number(attributes.target_temp_high);
      if (Number.isFinite(low) && Number.isFinite(high)) return { low, high };
      return null;
    }

    _entityMode() {
      const state = this._state(this._config.climate)?.state;
      if (!state || state === "unavailable" || state === "unknown") return "";
      return state;
    }

    _currentMode() { return this._pendingMode || this._entityMode(); }

    _hvacModes() {
      const modes = this._state(this._config.climate)?.attributes?.hvac_modes;
      if (!Array.isArray(modes)) return [];
      return modes.filter(mode => typeof mode === "string" && mode);
    }

    _action() {
      const action = this._state(this._config.climate)?.attributes?.hvac_action;
      if (action && ACTION_LABEL[action]) {
        return { label: ACTION_LABEL[action], kind: action === "cooling" ? "cool" : action === "heating" || action === "preheating" ? "heat" : "" };
      }
      const mode = this._currentMode();
      return { label: HVAC_LABEL[mode] || "", kind: mode === "cool" ? "cool" : mode === "heat" ? "heat" : "" };
    }

    _step() {
      const step = Number(this._state(this._config.climate)?.attributes?.target_temp_step ?? 0.5);
      if (!Number.isFinite(step) || step <= 0 || step > 5) return 0.5;
      return step;
    }

    _digits() {
      return Math.min(2, (String(this._step()).split(".")[1] || "").length);
    }

    _bounds() {
      const attributes = this._state(this._config.climate)?.attributes || {};
      let min = Number(attributes.min_temp ?? 5);
      let max = Number(attributes.max_temp ?? 35);
      if (!Number.isFinite(min)) min = 5;
      if (!Number.isFinite(max)) max = 35;
      return min <= max ? { min, max } : { min: max, max: min };
    }

    _round(value) {
      const step = this._step();
      const digits = Math.min(2, (String(step).split(".")[1] || "").length);
      return Number((Math.round(value / step) * step).toFixed(digits));
    }

    _clamp(value) {
      const { min, max } = this._bounds();
      return Math.min(max, Math.max(min, value));
    }

    _same(left, right) {
      return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.001;
    }

    _unit(entity, fallback = "°C") {
      const attributes = this._state(entity)?.attributes || {};
      return attributes.unit_of_measurement || attributes.temperature_unit || fallback;
    }

    _numericState(entity) {
      const value = Number(this._state(entity)?.state);
      return Number.isFinite(value) ? value : null;
    }

    _formatNumber(value, digits) {
      const number = Number(value);
      if (!Number.isFinite(number)) return "—";
      return new Intl.NumberFormat("pl-PL", {
        minimumFractionDigits: Number.isInteger(number) ? 0 : digits,
        maximumFractionDigits: digits,
      }).format(number);
    }

    _setReading(valueNode, unitNode, value, unit) {
      if (value == null) {
        valueNode.textContent = "—";
        unitNode.textContent = "";
        return;
      }
      valueNode.textContent = this._formatNumber(value, valueNode === this._ui.targetValue ? this._digits() : 1);
      unitNode.textContent = unit || "";
    }

    _formatMeasurement(state, kind) {
      if (!state || ["unavailable", "unknown", ""].includes(state.state)) return null;
      const number = Number(state.state);
      if (!Number.isFinite(number)) return state.state;
      const digits = kind === "power" && Math.abs(number) >= 100 ? 0 : 1;
      const text = this._formatNumber(number, digits);
      const unit = state.attributes?.unit_of_measurement || (kind === "power" ? "W" : "");
      return unit ? `${text} ${unit}` : text;
    }

    _powerReading() {
      if (this._config.power) {
        const formatted = this._formatMeasurement(this._state(this._config.power), "power");
        return formatted == null ? "—" : formatted;
      }
      const attributes = this._state(this._config.plug)?.attributes || {};
      const raw = [attributes.current_power_w, attributes.current_power, attributes.power, attributes.power_consumption]
        .find(value => value != null && value !== "" && typeof value !== "object");
      if (raw == null) return null;
      const number = Number(raw);
      if (!Number.isFinite(number)) return String(raw);
      const digits = Math.abs(number) >= 100 ? 0 : 1;
      return `${this._formatNumber(number, digits)} W`;
    }

    _clearNotice() { this._notice = ""; this._noticeError = false; }

    _fail(text) {
      this._notice = text;
      this._noticeError = true;
      this._update();
    }

    _errorText(error) {
      return typeof error?.message === "string" && error.message
        ? error.message
        : "Sprawdź połączenie z Home Assistant.";
    }
  }

  HaCardKit.register(TAG, PomieszczenieCard, {
    name: "Pomieszczenie",
    description: "Nazwa, termostat, termometr, odczyt gniazdka i do trzech świateł.",
  });
})();
;

// Source: src/cards/pomieszczenie/editor.js
(() => {
  const TAG = "ha-pomieszczenie-editor";
  if (customElements.get(TAG)) return;

  class RoomEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._selects = [];
      this._signature = "";
    }

    setConfig(config) {
      const signature = JSON.stringify(config || {});
      if (signature === this._signature) return;
      const defaults = customElements.get("ha-pomieszczenie-card").getStubConfig();
      const incoming = HaCardKit.clone(config || {});
      const sourceLights = Array.isArray(incoming.lights) ? incoming.lights : [];
      this._config = { ...defaults, ...incoming };
      this._config.lights = Array.from({ length: 3 }, (_, index) => ({
        entity: sourceLights[index]?.entity || "",
        name: sourceLights[index]?.name || "",
        icon: sourceLights[index]?.icon || defaults.lights[index].icon,
      }));
      this._signature = signature;
      this._render();
    }

    set hass(value) { this._hass = value; this._updateOptions(); }
    get hass() { return this._hass; }

    _commit(mutator) {
      const next = HaCardKit.clone(this._config);
      mutator(next);
      this._config = next;
      this._signature = JSON.stringify(next);
      this.dispatchEvent(new CustomEvent("config-changed", {
        detail: { config: next }, bubbles: true, composed: true,
      }));
    }

    _textField(parent, labelText, value, onChange, { limit, placeholder } = {}) {
      const label = document.createElement("label");
      label.className = "field";
      const caption = document.createElement("span");
      caption.textContent = labelText;
      const input = document.createElement("input");
      input.type = "text";
      input.value = value ?? "";
      if (limit) input.maxLength = limit;
      if (placeholder) input.placeholder = placeholder;
      input.addEventListener("input", () => onChange(input.value));
      label.append(caption, input);
      parent.append(label);
      return input;
    }

    _accepts(state, filter) {
      if (!filter) return true;
      const deviceClass = state?.attributes?.device_class;
      const unit = state?.attributes?.unit_of_measurement;
      if (filter === "temperature") return deviceClass === "temperature" || unit === "°C" || unit === "°F" || unit === "C" || unit === "F";
      if (filter === "power") return deviceClass === "power" || unit === "W" || unit === "kW";
      return deviceClass === filter;
    }

    _entityField(parent, labelText, domain, value, onChange, filter) {
      const label = document.createElement("label");
      label.className = "field";
      const caption = document.createElement("span");
      caption.textContent = labelText;
      const select = document.createElement("select");
      const binding = { select, domains: [].concat(domain), filter: filter || "", value: value || "", signature: null };
      select.addEventListener("change", () => {
        binding.value = select.value;
        onChange(select.value);
      });
      this._selects.push(binding);
      label.append(caption, select);
      parent.append(label);
    }

    _updateOptions() {
      for (const binding of this._selects) {
        const entries = Object.entries(this._hass?.states || {})
          .filter(([id, state]) => binding.domains.some(domain => id.startsWith(`${domain}.`)) && this._accepts(state, binding.filter))
          .map(([id, state]) => [id, state.attributes?.friendly_name || id])
          .sort((a, b) => a[1].localeCompare(b[1], "pl"));
        const signature = JSON.stringify([entries, binding.value]);
        if (signature === binding.signature) continue;
        binding.signature = signature;
        binding.select.replaceChildren();
        const add = (optionValue, text) => {
          const option = document.createElement("option");
          option.value = optionValue;
          option.textContent = text;
          binding.select.append(option);
        };
        add("", "— Nie wybrano —");
        if (binding.value && !entries.some(([id]) => id === binding.value)) {
          add(binding.value, `${binding.value} (brak encji)`);
        }
        entries.forEach(([id, name]) => add(id, `${name} · ${id}`));
        binding.select.value = binding.value;
      }
    }

    _render() {
      this._selects = [];
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: block; color: var(--primary-text-color); font-family: inherit; }
          * { box-sizing: border-box; }
          .form { display: grid; gap: 18px; padding: 4px 0; }
          .field { display: grid; gap: 7px; font-size: 13px; min-width: 0; }
          .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
          input, select { font: inherit; color: var(--primary-text-color); }
          input, select { width: 100%; min-width: 0; min-height: 42px; padding: 9px; border: 1px solid var(--divider-color); border-radius: 8px; background: var(--card-background-color); font-size: 16px; }
          fieldset { margin: 0; border: 1px solid var(--divider-color); border-radius: 10px; padding: 14px; min-width: 0; display: grid; gap: 12px; }
          legend { font-size: 14px; font-weight: 500; padding: 0 6px; }
          .help { color: var(--secondary-text-color); font-size: 12px; line-height: 1.6; margin: 0; }
          input:focus-visible, select:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
          h3 { font-size: 15px; font-weight: 500; margin: 0; }
          @media (max-width: 420px) { .grid { grid-template-columns: 1fr; } }
        </style>
        <div class="form">
          <div class="general"></div>
          <p class="help plug-help"></p>
          <h3>Światła</h3>
          <p class="help light-help"></p>
          <div class="lights"></div>
        </div>`;
      const q = selector => this.shadowRoot.querySelector(selector);
      const general = q(".general");
      this._textField(general, "Nazwa pomieszczenia", this._config.name, value => this._commit(config => { config.name = value; }), {
        limit: 80, placeholder: "Pomieszczenie",
      });
      this._entityField(general, "Termostat", "climate", this._config.climate, value => this._commit(config => { config.climate = value; }));
      this._entityField(general, "Termometr", "sensor", this._config.thermometer, value => this._commit(config => { config.thermometer = value; }), "temperature");
      this._entityField(general, "Gniazdko", "switch", this._config.plug, value => this._commit(config => { config.plug = value; }));
      this._entityField(general, "Moc gniazdka", "sensor", this._config.power, value => this._commit(config => { config.power = value; }), "power");
      q(".plug-help").textContent = "Gniazdko jest tylko informacją: czy jest włączone i jaki jest pobór mocy. Z tej karty nie da się go wyłączyć. Bez czujnika mocy karta sprawdzi atrybuty gniazdka.";
      q(".light-help").textContent = "Do trzech świateł, encja light albo switch. Pusty slot nie pojawia się na karcie. Przycisk włącza i wyłącza wybrane światło.";
      this._config.lights.forEach((light, index) => {
        const fieldset = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.textContent = `Światło ${index + 1}`;
        fieldset.append(legend);
        this._entityField(fieldset, "Encja światła", ["light", "switch"], light.entity, value => this._commit(config => { config.lights[index].entity = value; }));
        const grid = document.createElement("div");
        grid.className = "grid";
        this._textField(grid, "Nazwa na karcie", light.name, value => this._commit(config => { config.lights[index].name = value; }), { limit: 60 });
        this._textField(grid, "Ikona", light.icon, value => this._commit(config => { config.lights[index].icon = value; }), {
          limit: 80, placeholder: "mdi:ceiling-light",
        });
        fieldset.append(grid);
        q(".lights").append(fieldset);
      });
      this._updateOptions();
    }
  }

  customElements.define(TAG, RoomEditor);
})();
;

// Source: src/cards/powiedz-w-domu/card.js
/** Powiedz w domu — text, speech recognition and a backend HA script. */
(() => {
  const TAG = "powiedz-w-domu-card";
  if (customElements.get(TAG)) return;

  const DEFAULT_PRESETS = [
    { label: "Obiad gotowy", text: "Obiad gotowy. Zapraszam do stołu!", icon: "mdi:silverware-fork-knife" },
    { label: "Wychodzimy za 5 min", text: "Wychodzimy za pięć minut. Przygotujcie się!", icon: "mdi:door-open" },
    { label: "Chodźcie do salonu", text: "Proszę, przyjdźcie na chwilę do salonu.", icon: "mdi:account-group" },
    { label: "Dobranoc", text: "Czas spać. Dobranoc!", icon: "mdi:weather-night" },
  ];
  const LIMIT = 1000;
  const ENTITY = /^media_player\.[a-z0-9_]+$/;
  const SCRIPT = /^script\.[a-z0-9_]+$/;

  class PowiedzWDomuCard extends HTMLElement {
    static getConfigElement() {
      return document.createElement("powiedz-w-domu-editor");
    }
    static getStubConfig() {
      return {
        title: "Powiedz w domu", script: "", language: "pl-PL", show_dictation: true,
        speakers: [
          { entity: "", name: "Salon", icon: "mdi:sofa" },
          { entity: "", name: "Kuchnia", icon: "mdi:pot-steam" },
        ],
        presets: DEFAULT_PRESETS.map(preset => ({ ...preset })),
      };
    }
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._text = "";
      this._sending = false;
      this._recognition = null;
      this._revision = 0;
      this._notice = "";
      this._noticeError = false;
    }

    setConfig(config) {
      if (!config || (config.script && !SCRIPT.test(config.script))) {
        throw new Error("Podaj script, np. script.powiedz_w_domu.");
      }
      const speakers = config.speakers ?? PowiedzWDomuCard.getStubConfig().speakers;
      const chosen = Array.isArray(speakers) ? speakers.map(s => s?.entity).filter(Boolean) : [];
      if (!Array.isArray(speakers) || speakers.length !== 2 ||
          speakers.some(s => !s || (s.entity && !ENTITY.test(s.entity))) ||
          new Set(chosen).size !== chosen.length) {
        throw new Error("speakers musi zawierać dwa różne głośniki z entity: media_player.…");
      }
      const presets = config.presets ?? DEFAULT_PRESETS;
      if (!Array.isArray(presets) || presets.some(p => !p ||
          typeof p.text !== "string" || p.text.length > LIMIT)) {
        throw new Error("Każdy preset musi mieć pole text (maks. 1000 znaków).");
      }
      this._cancelRecognition();
      this._revision += 1;
      this._config = {
        title: String(config.title ?? "Powiedz w domu"),
        script: config.script || "",
        language: String(config.language ?? "pl-PL"),
        show_dictation: config.show_dictation !== false,
        speakers: speakers.map(s => ({
          entity: s.entity || "", name: s.name == null ? null : String(s.name),
          icon: String(s.icon || "mdi:speaker"),
        })),
        presets: presets.map(p => ({
          text: p.text, label: String(p.label || p.text || "Nowy komunikat"),
          icon: String(p.icon || "mdi:message-text-outline"),
        })),
      };
      if (!this._config.speakers.some(s => s.entity === this._selected)) {
        this._selected = this._config.speakers[0].entity;
      }
      this._notice = "";
      this._build();
      this._update();
    }

    // HA updates this frequently. Never rebuild the editor here: preserve typing,
    // focus, selection, and ongoing speech recognition when entity states change.
    set hass(value) { this._hass = value; this._update(); }
    get hass() { return this._hass; }
    connectedCallback() { this._update(); }
    disconnectedCallback() { this._cancelRecognition(); }
    getCardSize() { return 10; }
    getGridOptions() { return { columns: 12, rows: "auto", min_columns: 6 }; }

    _icon(name) {
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", name);
      icon.setAttribute("aria-hidden", "true");
      return icon;
    }

    _build() {
      // Only static markup goes through innerHTML. All config/user strings are
      // assigned via textContent/value/setAttribute, never interpreted as HTML.
      this.shadowRoot.innerHTML = `
        <style>
          :host { display:block; color:var(--primary-text-color); }
          * { box-sizing:border-box; }
          ha-card { overflow:hidden; }
          header { display:flex; gap:12px; align-items:center; padding:22px 22px 16px; }
          .brand { display:grid; place-items:center; width:44px; height:44px; flex:none;
            border-radius:14px; color:var(--primary-color); background:var(--secondary-background-color); }
          h2 { margin:0 0 4px; font-size:21px; font-weight:500; line-height:1.3; overflow-wrap:anywhere; }
          header p { margin:0; font-size:13px; color:var(--secondary-text-color); }
          .content { padding:0 22px 22px; }
          .label { display:block; margin:7px 0 10px; font-size:13px; font-weight:500; }
          button,textarea { font:inherit; }
          button { cursor:pointer; color:var(--primary-text-color); }
          button:disabled { cursor:default; opacity:.55; }
          button:focus-visible,textarea:focus-visible { outline:3px solid var(--primary-color); outline-offset:3px; }
          .speakers { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-bottom:22px; }
          .speaker { display:flex; align-items:center; gap:9px; text-align:left; min-height:75px; min-width:0;
            padding:12px; border:1px solid var(--divider-color); border-radius:13px; background:var(--card-background-color); }
          .speaker[aria-pressed=true] { border-color:var(--primary-color); background:var(--secondary-background-color); }
          .speaker[aria-pressed=true] ha-icon { color:var(--primary-color); }
          .speaker-copy { display:flex; flex-direction:column; gap:5px; flex:1; min-width:0; }
          .speaker-name { font-size:14px; font-weight:500; overflow-wrap:anywhere; }
          .speaker-state { font-size:11px; color:var(--secondary-text-color); }
          .radio { width:15px; height:15px; border:1.5px solid var(--secondary-text-color); border-radius:50%; flex:none; }
          .speaker[aria-pressed=true] .radio { border:4.5px solid var(--primary-color); }
          .editor { border:1px solid var(--divider-color); border-radius:12px; overflow:hidden; }
          .editor:focus-within { border-color:var(--primary-color); }
          textarea { display:block; width:100%; min-height:116px; resize:vertical; padding:13px 14px 6px;
            border:0; background:var(--card-background-color); color:var(--primary-text-color); font-size:16px; line-height:1.6; }
          textarea::placeholder { color:var(--secondary-text-color); opacity:1; }
          .editor-footer { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 10px; }
          .dictate { display:flex; align-items:center; gap:6px; min-height:40px; padding:6px 10px;
            border:0; border-radius:8px; color:var(--primary-color); background:var(--secondary-background-color); font-size:13px; }
          .dictate[aria-pressed=true] { color:var(--error-color); }
          .count { font-size:11px; font-variant-numeric:tabular-nums; color:var(--secondary-text-color); }
          .speech-help { font-size:12px; line-height:1.5; color:var(--secondary-text-color); margin:9px 0 0; }
          .presets-label { font-size:12px; font-weight:500; margin:19px 0 10px; }
          .presets-label span { font-weight:400; color:var(--secondary-text-color); }
          .presets { display:flex; flex-wrap:wrap; gap:8px; }
          .preset { display:flex; align-items:center; gap:6px; min-height:38px; max-width:100%; text-align:left;
            border:1px solid var(--divider-color); border-radius:22px; background:var(--secondary-background-color); padding:8px 11px; font-size:12px; }
          .preset span { overflow-wrap:anywhere; min-width:0; }
          ha-icon { --mdc-icon-size:20px; flex:none; }
          .preset ha-icon { --mdc-icon-size:16px; color:var(--secondary-text-color); }
          footer { border-top:1px solid var(--divider-color); padding:18px 22px 15px; }
          .send { display:flex; justify-content:center; align-items:center; gap:9px; width:100%; min-height:48px;
            border:0; border-radius:12px; padding:12px; font-size:15px; font-weight:500;
            background:var(--primary-color); color:var(--text-primary-color,#fff); }
          .send span { overflow-wrap:anywhere; min-width:0; }
          .status { margin-top:11px; font-size:12px; line-height:1.5; min-height:18px; text-align:center;
            color:var(--secondary-text-color); overflow-wrap:anywhere; }
          .status.error { color:var(--error-color); }
          [hidden] { display:none!important; }
          @media(max-width:380px) { header {padding:20px 16px 16px} .content {padding:0 16px 20px}
            footer {padding:16px} .speaker {padding:11px 8px;gap:7px} .presets-label span {display:block;margin-top:4px} }
          @media(pointer:coarse) { .preset,.dictate {min-height:44px} }
        </style>
        <ha-card>
          <header><div class="brand"><ha-icon icon="mdi:bullhorn-outline" aria-hidden="true"></ha-icon></div>
            <div><h2></h2><p>Wiadomość na wybranym głośniku</p></div></header>
          <div class="content">
            <div class="label" id="speakers-label">Gdzie odtworzyć?</div>
            <div class="speakers" role="group" aria-labelledby="speakers-label"></div>
            <label class="label" for="message">Treść wiadomości</label>
            <div class="editor">
              <textarea id="message" rows="4" maxlength="1000" placeholder="Co chcesz przekazać domownikom?"></textarea>
              <div class="editor-footer"><button type="button" class="dictate" aria-pressed="false" aria-describedby="speech-help">
                <ha-icon icon="mdi:microphone" aria-hidden="true"></ha-icon><span>Dyktuj</span></button><span class="count"></span></div>
            </div>
            <p class="speech-help" id="speech-help"></p>
            <div class="preset-section"><div class="presets-label">Gotowe wiadomości <span>· kliknij, aby wstawić</span></div>
              <div class="presets"></div></div>
          </div>
          <footer><button type="button" class="send"><ha-icon icon="mdi:play" aria-hidden="true"></ha-icon><span></span></button>
            <div class="status" role="status" aria-live="polite" aria-atomic="true"></div></footer>
        </ha-card>`;
      const q = s => this.shadowRoot.querySelector(s);
      this._ui = { text: q("textarea"), count: q(".count"), mic: q(".dictate"),
        micLabel: q(".dictate span"), micIcon: q(".dictate ha-icon"), help: q(".speech-help"),
        send: q(".send"), sendLabel: q(".send span"), status: q(".status"), speakers: [], presets: [] };
      q("h2").textContent = this._config.title;
      this._ui.text.value = this._text;
      this._config.speakers.forEach(speaker => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "speaker";
        button.innerHTML = '<span class="speaker-copy"><span class="speaker-name"></span><span class="speaker-state"></span></span><span class="radio" aria-hidden="true"></span>';
        button.prepend(this._icon(speaker.icon));
        button.addEventListener("click", () => {
          this._selected = speaker.entity; this._notice = ""; this._update();
        });
        q(".speakers").append(button);
        this._ui.speakers.push({ button, speaker, name: button.querySelector(".speaker-name"), state: button.querySelector(".speaker-state") });
      });
      this._config.presets.forEach(preset => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "preset";
        const label = document.createElement("span");
        label.textContent = preset.label;
        button.append(this._icon(preset.icon), label);
        button.addEventListener("click", () => {
          this._text = preset.text;
          this._ui.text.value = this._text;
          this._notice = "";
          this._update();
          this._ui.text.focus();
        });
        q(".presets").append(button);
        this._ui.presets.push(button);
      });
      q(".preset-section").hidden = !this._config.presets.length;
      this._ui.text.addEventListener("input", () => {
        this._text = this._ui.text.value;
        this._notice = "";
        this._update();
      });
      this._ui.mic.addEventListener("click", () => this._toggleDictation());
      this._ui.send.addEventListener("click", () => this._send());
    }

    _name(speaker) {
      return speaker?.name || this._hass?.states?.[speaker?.entity]?.attributes?.friendly_name || speaker?.entity || "Wybierz głośnik";
    }

    _unavailable(entity) {
      const state = this._hass?.states?.[entity]?.state;
      return !state || state === "unavailable" || state === "unknown";
    }

    _problem() {
      if (this.preview) return "Podgląd karty — wysyłanie jest wyłączone.";
      if (!this._config.script || this._config.speakers.some(s => !s.entity)) {
        return "W edytorze karty wybierz skrypt i dwa głośniki.";
      }
      if (!this._hass || this._hass.connected === false) return "Brak połączenia z Home Assistant.";
      if (this._unavailable(this._config.script)) return "Skrypt jest niedostępny. Sprawdź jego identyfikator w konfiguracji karty.";
      if (this._unavailable(this._selected)) return "Wybrany głośnik jest niedostępny.";
      if (!this._text.trim()) return "Wpisz tekst lub wybierz gotową wiadomość.";
      if (this._text.length > LIMIT) return "Wiadomość może mieć maksymalnie 1000 znaków.";
      return "";
    }

    _speechProblem() {
      if (this.preview) return "Dyktowanie jest wyłączone w podglądzie karty.";
      if (!this._config.show_dictation) return "Dyktowanie jest wyłączone w konfiguracji.";
      if (!window.isSecureContext) return "Dyktowanie wymaga HTTPS. Możesz też użyć mikrofonu klawiatury telefonu.";
      if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
        return "Ta przeglądarka nie obsługuje przycisku Dyktuj. Użyj mikrofonu klawiatury telefonu lub wpisz tekst.";
      }
      return "";
    }

    _update() {
      if (!this._ui || !this._config) return;
      const ui = this._ui;
      const listening = !!this._recognition;
      const locked = this._sending || listening;
      ui.text.readOnly = locked;
      ui.count.textContent = `${ui.text.value.length} / ${LIMIT}`;
      ui.speakers.forEach(({ button, speaker, name, state }) => {
        const missing = this._unavailable(speaker.entity);
        button.setAttribute("aria-pressed", String(this._selected === speaker.entity));
        button.disabled = locked || missing || this._hass?.connected === false;
        name.textContent = this._name(speaker);
        state.textContent = !this._hass || this._hass.connected === false ? "Brak połączenia" : missing ? "Niedostępny" : "Dostępny";
      });
      ui.presets.forEach((button, index) => { button.disabled = locked || !this._config.presets[index].text.trim(); });
      const speechProblem = this._speechProblem();
      ui.mic.disabled = this._sending || !!speechProblem || !!this._stopping;
      ui.mic.hidden = !this._config.show_dictation;
      ui.help.hidden = !this._config.show_dictation;
      ui.mic.setAttribute("aria-pressed", String(listening));
      ui.micLabel.textContent = this._stopping ? "Kończenie…" : listening ? "Zakończ" : "Dyktuj";
      ui.micIcon.setAttribute("icon", listening ? "mdi:stop" : "mdi:microphone");
      ui.help.textContent = speechProblem || "Dyktowanie przez przeglądarkę. Rozpoznany tekst możesz poprawić.";
      ui.send.disabled = locked || !!this._problem();
      const selected = this._config.speakers.find(s => s.entity === this._selected);
      ui.sendLabel.textContent = this._sending ? "Wysyłanie…" : `Odtwórz · ${this._name(selected)}`;
      ui.status.textContent = this._notice || this._problem() || "Tekst zostanie przeczytany na wybranym głośniku.";
      ui.status.classList.toggle("error", !!this._notice && this._noticeError);
    }

    _setNotice(text, error = false) {
      this._notice = text;
      this._noticeError = error;
      this._update();
    }

    async _send() {
      if (this._sending || this._recognition) return;
      const problem = this._problem();
      if (problem) { this._setNotice(problem, true); return; }
      const revision = this._revision;
      const selected = this._config.speakers.find(s => s.entity === this._selected);
      const name = this._name(selected);
      this._sending = true;
      this._setNotice("Wysyłanie wiadomości…");
      try {
        // Direct script service: forwards fields and reports script execution errors.
        await this._hass.callService("script", this._config.script.slice(7), {
          tekst: this._text.trim(), glosnik: selected.entity,
        });
        if (revision === this._revision) this._setNotice(`Wysłano do głośnika: ${name}.`);
      } catch (error) {
        if (revision === this._revision) {
          const detail = typeof error?.message === "string" ? error.message : "Sprawdź połączenie i ślad wykonania skryptu.";
          this._setNotice(`Nie udało się wysłać. ${detail}`, true);
        }
      } finally {
        this._sending = false;
        this._update();
      }
    }

    _cancelRecognition() {
      const recognition = this._recognition;
      this._recognition = null;
      this._stopping = false;
      clearTimeout(this._speechTimer);
      if (recognition) {
        recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
        try { recognition.abort(); } catch { /* Already stopped. */ }
        if (this._ui) this._ui.text.value = this._text;
        this._notice = "";
      }
    }

    _toggleDictation() {
      if (this._sending) return;
      if (this._recognition) {
        if (this._stopping) return;
        this._stopping = true;
        this._setNotice("Kończenie dyktowania…");
        try { this._recognition.stop(); } catch {
          this._cancelRecognition(); this._setNotice("Dyktowanie zakończone. Sprawdź tekst."); return;
        }
        if (!this._recognition) return;
        // Some embedded browsers never emit end after stop; release controls.
        this._speechTimer = setTimeout(() => {
          if (!this._recognition) return;
          this._cancelRecognition();
          this._setNotice("Dyktowanie zakończone. Sprawdź tekst.");
        }, 5000);
        return;
      }
      const problem = this._speechProblem();
      if (problem) { this._setNotice(problem, true); return; }
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      let recognition;
      try { recognition = new Recognition(); } catch {
        this._setNotice("Nie można uruchomić dyktowania w tej przeglądarce.", true); return;
      }
      const original = this._text.trimEnd();
      const join = spoken => [original, spoken.trim()].filter(Boolean).join(" ").slice(0, LIMIT);
      let heard = false;
      let failed = false;
      let limited = false;
      recognition.lang = this._config.language;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      this._recognition = recognition;
      const current = () => this._recognition === recognition;
      recognition.onstart = () => { if (current()) this._setNotice("Słucham… Powiedz wiadomość."); };
      recognition.onresult = event => {
        if (!current()) return;
        const final = [], interim = [];
        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          (result.isFinal ? final : interim).push(result[0].transcript);
        }
        if (final.length) heard = true;
        const finalText = final.join(" ");
        limited = [original, finalText].filter(Boolean).join(" ").length > LIMIT;
        // Interim results are displayed but never become the text sent to HA.
        this._text = join(finalText);
        this._ui.text.value = join([...final, ...interim].join(" "));
        this._update();
      };
      recognition.onerror = event => {
        if (!current()) return;
        failed = true;
        const errors = {
          "not-allowed": "Brak dostępu do mikrofonu. Zezwól na mikrofon w przeglądarce i sprawdź HTTPS.",
          "service-not-allowed": "Przeglądarka zablokowała usługę rozpoznawania mowy.",
          "audio-capture": "Nie można użyć mikrofonu. Sprawdź, czy jest podłączony i dostępny.",
          "no-speech": "Nie wykryto mowy. Spróbuj ponownie.",
          "network": "Usługa rozpoznawania mowy jest niedostępna. Sprawdź internet.",
          "language-not-supported": "Usługa rozpoznawania nie obsługuje wybranego języka.",
          "aborted": "Dyktowanie przerwano.",
        };
        this._cancelRecognition();
        this._setNotice(errors[event.error] || "Dyktowanie nie powiodło się. Spróbuj ponownie.", true);
      };
      recognition.onend = () => {
        if (!current()) return;
        this._recognition = null;
        this._stopping = false;
        clearTimeout(this._speechTimer);
        this._ui.text.value = this._text;
        if (!failed) this._setNotice(limited ? "Osiągnięto limit 1000 znaków. Sprawdź tekst." :
          heard ? "Tekst rozpoznany. Sprawdź go przed odtworzeniem." : "Nie rozpoznano tekstu. Spróbuj ponownie.");
        this._update();
      };
      this._setNotice("Uruchamianie mikrofonu…");
      try { recognition.start(); } catch {
        this._cancelRecognition();
        this._setNotice("Nie udało się uruchomić mikrofonu. Sprawdź uprawnienia przeglądarki.", true);
      }
    }
  }

  HaCardKit.register(TAG, PowiedzWDomuCard, {
    name: "Powiedz w domu",
    description: "Dwa głośniki, wiadomość, dyktowanie i gotowe komunikaty.",
  });
})();
;

// Source: src/cards/powiedz-w-domu/editor.js
(() => {
  const TAG = "powiedz-w-domu-editor";
  if (customElements.get(TAG)) return;

  class AnnouncementEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._selects = [];
      this._signature = "";
    }

    setConfig(config) {
      // HA echoes config-changed. Do not rebuild an active input on that echo.
      const signature = JSON.stringify(config);
      if (signature === this._signature) return;
      const defaults = customElements.get("powiedz-w-domu-card").getStubConfig();
      this._config = { ...defaults, ...HaCardKit.clone(config) };
      this._config.speakers = Array.from({ length: 2 }, (_, index) => ({
        ...defaults.speakers[index], ...(config.speakers?.[index] || {}),
      }));
      this._config.presets = HaCardKit.clone(config.presets ?? defaults.presets);
      this._signature = JSON.stringify(config);
      this._render();
    }

    set hass(value) { this._hass = value; this._updateOptions(); }
    get hass() { return this._hass; }

    _commit(mutator, rebuild = false) {
      const next = HaCardKit.clone(this._config);
      mutator(next);
      this._config = next;
      this._signature = JSON.stringify(next);
      if (rebuild) this._render();
      this.dispatchEvent(new CustomEvent("config-changed", {
        detail: { config: next }, bubbles: true, composed: true,
      }));
    }

    _textField(parent, labelText, value, onChange, { multiline = false, limit } = {}) {
      const label = document.createElement("label");
      label.className = "field";
      const caption = document.createElement("span"); caption.textContent = labelText;
      const input = document.createElement(multiline ? "textarea" : "input");
      if (!multiline) input.type = "text";
      else input.rows = 2;
      input.value = value ?? "";
      if (limit) input.maxLength = limit;
      input.addEventListener("input", () => onChange(input.value));
      label.append(caption, input); parent.append(label);
      return input;
    }

    _entityField(parent, labelText, domain, value, onChange) {
      const label = document.createElement("label"); label.className = "field";
      const caption = document.createElement("span"); caption.textContent = labelText;
      const select = document.createElement("select");
      select.required = true;
      const binding = { select, domain, value: value || "", signature: null };
      select.addEventListener("change", () => { binding.value = select.value; onChange(select.value); });
      this._selects.push(binding);
      label.append(caption, select); parent.append(label);
    }

    _updateOptions() {
      for (const binding of this._selects) {
        const entries = Object.entries(this._hass?.states || {})
          .filter(([id]) => id.startsWith(`${binding.domain}.`))
          .map(([id, state]) => [id, state.attributes?.friendly_name || id])
          .sort((a, b) => a[1].localeCompare(b[1], "pl"));
        const signature = JSON.stringify([entries, binding.value]);
        if (signature === binding.signature) continue;
        binding.signature = signature;
        binding.select.replaceChildren();
        const add = (value, text) => {
          const option = document.createElement("option"); option.value = value; option.textContent = text;
          binding.select.append(option);
        };
        add("", "— Wybierz encję —");
        if (binding.value && !entries.some(([id]) => id === binding.value)) {
          add(binding.value, `${binding.value} (brak encji)`);
        }
        entries.forEach(([id, name]) => add(id, `${name} · ${id}`));
        binding.select.value = binding.value;
      }
    }

    _presetAction(label, index, delta) {
      const button = document.createElement("button"); button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-label", `${label} — komunikat ${index + 1}`);
      button.disabled = delta !== 0 && (index + delta < 0 || index + delta >= this._config.presets.length);
      button.addEventListener("click", () => this._commit(config => {
        if (!delta) config.presets.splice(index, 1);
        else [config.presets[index], config.presets[index + delta]] = [config.presets[index + delta], config.presets[index]];
      }, true));
      return button;
    }

    _render() {
      this._selects = [];
      this.shadowRoot.innerHTML = `
        <style>
          :host {display:block;color:var(--primary-text-color);font-family:inherit}
          * {box-sizing:border-box}
          .form {display:grid;gap:18px;padding:4px 0}
          .field {display:grid;gap:7px;font-size:13px;min-width:0}
          .grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
          input,textarea,select,button {font:inherit;color:var(--primary-text-color)}
          input,textarea,select {width:100%;min-width:0;min-height:42px;padding:9px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);font-size:16px}
          textarea {resize:vertical}
          fieldset {margin:0;border:1px solid var(--divider-color);border-radius:10px;padding:14px;min-width:0;display:grid;gap:12px}
          legend {font-size:14px;font-weight:500;padding:0 6px}
          .help {color:var(--secondary-text-color);font-size:12px;line-height:1.6;margin:0}
          .switch {display:flex;align-items:center;gap:8px;font-size:14px}
          .switch input {width:18px;min-height:18px}
          .presets {display:grid;gap:12px}
          .actions {display:flex;flex-wrap:wrap;gap:8px}
          button {min-height:40px;padding:8px 12px;background:var(--secondary-background-color);border:1px solid var(--divider-color);border-radius:8px;cursor:pointer}
          button:disabled {opacity:.4;cursor:default}
          button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible {outline:2px solid var(--primary-color);outline-offset:2px}
          h3 {font-size:15px;font-weight:500;margin:0}
          @media(max-width:420px) {.grid{grid-template-columns:1fr}}
        </style>
        <div class="form">
          <div class="general"></div>
          <div class="speaker-settings"></div>
          <div class="speech-settings"></div>
          <h3>Gotowe wiadomości</h3><p class="help">Kliknięcie komunikatu wypełnia pole. Dopiero „Odtwórz” uruchamia skrypt.</p>
          <div class="presets"></div><div><button type="button" class="add">+ Dodaj komunikat</button></div>
        </div>`;
      const q = s => this.shadowRoot.querySelector(s);
      const general = q(".general"); general.classList.add("form");
      this._textField(general, "Tytuł karty", this._config.title, value => this._commit(c => { c.title = value; }));
      this._entityField(general, "Skrypt odtwarzania", "script", this._config.script, value => this._commit(c => { c.script = value; }));
      const help = document.createElement("p"); help.className = "help";
      help.textContent = "Skrypt musi przyjmować tekst i glosnik. Przykład do jednorazowego utworzenia w HA znajdziesz w examples/powiedz-w-domu-script.yaml.";
      general.append(help);
      const speakers = q(".speaker-settings"); speakers.classList.add("form");
      this._config.speakers.forEach((speaker, index) => {
        const fieldset = document.createElement("fieldset");
        const legend = document.createElement("legend"); legend.textContent = `Głośnik ${index + 1}`; fieldset.append(legend);
        this._entityField(fieldset, "Encja głośnika", "media_player", speaker.entity,
          value => this._commit(c => { c.speakers[index].entity = value; }));
        const grid = document.createElement("div"); grid.className = "grid";
        this._textField(grid, "Nazwa na karcie", speaker.name, value => this._commit(c => { c.speakers[index].name = value; }));
        this._textField(grid, "Ikona (np. mdi:speaker)", speaker.icon, value => this._commit(c => { c.speakers[index].icon = value; }));
        fieldset.append(grid); speakers.append(fieldset);
      });
      const speech = q(".speech-settings"); speech.classList.add("form");
      const toggle = document.createElement("label"); toggle.className = "switch";
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = this._config.show_dictation !== false;
      checkbox.addEventListener("change", () => this._commit(c => { c.show_dictation = checkbox.checked; }));
      const caption = document.createElement("span"); caption.textContent = "Pokaż przycisk dyktowania";
      toggle.append(checkbox, caption); speech.append(toggle);
      this._textField(speech, "Język dyktowania", this._config.language, value => this._commit(c => { c.language = value; }));
      const speechHelp = document.createElement("p"); speechHelp.className = "help";
      speechHelp.textContent = "Dyktowanie korzysta z przeglądarki, może używać chmury i wymaga HTTPS. Obsługa zależy od urządzenia. To ustawienie nie zmienia głosu TTS.";
      speech.append(speechHelp);
      this._config.presets.forEach((preset, index) => {
        const fieldset = document.createElement("fieldset");
        const legend = document.createElement("legend"); legend.textContent = `Komunikat ${index + 1}`; fieldset.append(legend);
        this._textField(fieldset, "Etykieta przycisku", preset.label, value => this._commit(c => { c.presets[index].label = value; }));
        this._textField(fieldset, "Treść wiadomości", preset.text, value => this._commit(c => { c.presets[index].text = value; }), { multiline: true, limit: 1000 });
        this._textField(fieldset, "Ikona", preset.icon, value => this._commit(c => { c.presets[index].icon = value; }));
        const actions = document.createElement("div"); actions.className = "actions";
        actions.append(this._presetAction("W górę", index, -1), this._presetAction("W dół", index, 1), this._presetAction("Usuń", index, 0));
        fieldset.append(actions); q(".presets").append(fieldset);
      });
      q(".add").addEventListener("click", () => this._commit(c => {
        c.presets.push({ label: "Nowy komunikat", text: "", icon: "mdi:message-text-outline" });
      }, true));
      this._updateOptions();
    }
  }
  customElements.define(TAG, AnnouncementEditor);
})();
;
})();
