/** ha-custom-cards v1.0.3 | MIT | Generated: edit src/, not dist/. */
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
/** Karta pomieszczenia — układ: nazwa, światło, termostat, termometr, gniazdko. */
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
  const ACTION_LABEL = {
    heating: "Grzeje", cooling: "Chłodzi", idle: "Bezczynny", off: "Wyłączony",
    drying: "Osusza", fan: "Nawiew", preheating: "Nagrzewa", defrosting: "Odszrania",
  };
  const RADIATOR_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M7.2 3.6c.7 1-.7 1.5 0 2.6M12 3.1c.7 1-.7 1.5 0 2.6M16.8 3.6c.7 1-.7 1.5 0 2.6"/><path fill="currentColor" d="M5 9.2h14v1.55H5zm1.15 1.9h2.35v8.05H6.15zm3.2 0h2.35v8.05H9.35zm3.2 0h2.35v8.05H12.55zm3.2 0h2.35v8.05H15.75zM5 19.55h14V21H5z"/></svg>`;

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
        climate_temperature: "",
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
      if (config.thermometer || config.climate || config.climate_temperature) rows += 2;
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
        climate_temperature: entity(config.climate_temperature, ID.sensor, "Temperatura termostatu musi być encją sensor."),
        thermometer: entity(config.thermometer, ID.sensor, "Termometr musi być encją sensor."),
        plug: entity(config.plug, ID.switch, "Gniazdko musi być encją switch."),
        power: entity(config.power, ID.sensor, "Czujnik mocy musi być encją sensor."),
        lights,
      };
    }

    _icon(name) {
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", name);
      icon.setAttribute("aria-hidden", "true");
      return icon;
    }

    _radiatorIcon() {
      const wrap = document.createElement("span");
      wrap.className = "radiator-icon";
      wrap.setAttribute("aria-hidden", "true");
      wrap.innerHTML = RADIATOR_SVG;
      return wrap;
    }

    _build() {
      const style = document.createElement("style");
      style.textContent = `
        :host { display: block; color: #1f2430; }
        * { box-sizing: border-box; }
        ha-card {
          container-type: inline-size; display: block; padding: 20px 22px;
          overflow: hidden; position: relative;
          background: var(--card-background-color, #fff);
        }
        ha-card.lit {
          background:
            radial-gradient(95% 80% at 92% 6%, rgba(255, 214, 90, 0.48), transparent 52%),
            radial-gradient(70% 55% at 70% 18%, rgba(255, 196, 64, 0.18), transparent 60%),
            var(--card-background-color, #fff);
        }
        ha-card.heating-glow {
          background:
            radial-gradient(85% 75% at 18% 78%, rgba(255, 148, 48, 0.28), transparent 55%),
            var(--card-background-color, #fff);
        }
        ha-card.lit.heating-glow {
          background:
            radial-gradient(95% 80% at 92% 6%, rgba(255, 214, 90, 0.48), transparent 52%),
            radial-gradient(85% 75% at 18% 78%, rgba(255, 148, 48, 0.28), transparent 55%),
            var(--card-background-color, #fff);
        }
        .layout {
          display: grid;
          gap: 16px 18px;
          grid-template-columns: minmax(0, 1.1fr) minmax(15rem, 1fr);
          grid-template-areas:
            "name light"
            "climate meter"
            "climate plug";
          align-items: stretch;
        }
        .layout.no-light { grid-template-areas: "name name" "climate meter" "climate plug"; }
        .layout.no-meter { grid-template-areas: "name light" "climate plug" "climate plug"; }
        .layout.no-plug { grid-template-areas: "name light" "climate meter" "climate meter"; }
        .layout.no-meter.no-plug { grid-template-areas: "name light" "climate climate"; }
        .layout.no-climate { grid-template-areas: "name light" "meter meter" "plug plug"; }
        .layout.no-climate.no-light { grid-template-areas: "name name" "meter meter" "plug plug"; }
        .name-wrap { grid-area: name; display: flex; align-items: center; gap: 12px; min-width: 0; }
        .name-icon {
          display: grid; place-items: center; width: 40px; height: 40px; flex: none;
          border-radius: 12px; color: #2f7fe4; background: rgba(47, 127, 228, 0.12);
        }
        h2 {
          margin: 0; font-size: 28px; font-weight: 700; line-height: 1.15;
          letter-spacing: -0.02em; color: #111827; overflow-wrap: anywhere;
        }
        .tile {
          min-width: 0; border-radius: 20px; padding: 14px 16px;
          background: rgba(255, 255, 255, 0.55);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.55);
        }
        .light {
          grid-area: light; display: flex; align-items: center; gap: 12px; width: 100%;
          min-height: 52px; min-width: 0; padding: 6px 2px 6px 6px; border: 0; border-radius: 16px;
          text-align: left; cursor: pointer; color: #111827; background: transparent;
        }
        .light-icon {
          display: grid; place-items: center; width: 36px; height: 36px; flex: none;
          border-radius: 50%; color: #8b93a3; background: transparent;
        }
        .light-copy { flex: 1; min-width: 0; }
        .light-name { display: block; font-size: 18px; font-weight: 700; color: #111827; overflow-wrap: anywhere; }
        .switch {
          width: 46px; height: 26px; flex: none; border-radius: 999px;
          background: rgba(140, 150, 165, 0.35); position: relative;
        }
        .switch::after {
          content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px;
          border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.16);
          transition: transform .15s ease;
        }
        .light[aria-pressed="true"] .light-icon {
          color: #f0b400; background: rgba(255, 214, 90, 0.28);
          box-shadow: 0 0 18px rgba(255, 196, 64, 0.45);
        }
        .light[aria-pressed="true"] .switch { background: #2f7fe4; }
        .light[aria-pressed="true"] .switch::after { transform: translateX(20px); }
        .climate {
          grid-area: climate; display: flex; align-self: start; min-width: 0; padding: 4px 2px;
          background: transparent; border: 0; border-radius: 0; box-shadow: none;
        }
        .climate-body { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; }
        .climate-copy { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 8px; }
        .tile-label {
          display: flex; align-items: center; gap: 8px; margin: 0;
          font-size: 14px; font-weight: 500; color: #9aa3b2;
        }
        .tile-label ha-icon { color: #2f7fe4; }
        .reading {
          margin: 0; font-size: 56px; font-weight: 700; line-height: 0.95;
          letter-spacing: -0.04em; color: #0f172a; font-variant-numeric: tabular-nums;
        }
        .unit { margin-left: 2px; font-size: 24px; font-weight: 700; color: #0f172a; }
        .setpoint { margin: 0; font-size: 15px; font-weight: 500; color: #9aa3b2; }
        .setpoint strong { color: #111827; font-weight: 700; }
        .controls {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 10px; padding: 2px 0; flex: 0 0 auto;
        }
        .step {
          width: 40px; height: 40px; border-radius: 50%; font-size: 22px; line-height: 1; cursor: pointer;
          color: #111827; background: rgba(255,255,255,0.9); border: 1px solid rgba(210, 218, 228, 0.85);
        }
        .heat-badge {
          display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%;
          color: #9aa3b2; background: rgba(255,255,255,0.55);
        }
        .radiator-icon { display: block; width: 30px; height: 30px; }
        .radiator-icon svg { display: block; width: 100%; height: 100%; }
        .climate.heating .heat-badge {
          color: #f0841a; background: rgba(255, 168, 64, 0.28);
          box-shadow: 0 0 28px rgba(255, 140, 40, 0.5);
        }
        .meter, .plug {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          grid-template-areas: "icon copy" "icon value";
          align-items: center; column-gap: 12px; row-gap: 2px;
        }
        .meter { grid-area: meter; }
        .plug { grid-area: plug; }
        .meter-icon, .plug-icon { grid-area: icon; }
        .meter-copy, .plug-copy { grid-area: copy; min-width: 0; }
        .meter-value, .plug-power {
          grid-area: value; margin: 0; font-size: 28px; font-weight: 700; color: #0f172a;
          font-variant-numeric: tabular-nums; white-space: nowrap;
        }
        .meter-value .unit, .plug-power .unit { font-size: 15px; font-weight: 700; }
        .plug-icon, .meter-icon {
          display: grid; place-items: center; width: 36px; height: 36px;
          border-radius: 50%; color: #2f7fe4; background: rgba(255, 255, 255, 0.85);
        }
        .plug-name { margin: 0; font-size: 15px; font-weight: 600; color: #6b7280; }
        .plug-sub { margin: 2px 0 0; font-size: 12px; font-weight: 500; color: #9aa3b2; }
        .empty, .status { grid-column: 1 / -1; margin: 0; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; color: #9aa3b2; }
        .status.error { color: var(--error-color); }
        button:disabled { cursor: default; opacity: 0.45; }
        button:focus-visible { outline: 2px solid #2f7fe4; outline-offset: 2px; }
        [hidden] { display: none !important; }
        ha-icon { --mdc-icon-size: 20px; }
        .tile-label ha-icon { --mdc-icon-size: 18px; }
        .light-icon ha-icon, .plug-icon ha-icon, .meter-icon ha-icon, .name-icon ha-icon { --mdc-icon-size: 20px; }
        @container (max-width: 399px) {
          .layout, .layout.no-light, .layout.no-meter, .layout.no-plug,
          .layout.no-meter.no-plug, .layout.no-climate, .layout.no-climate.no-light {
            grid-template-columns: 1fr;
            grid-template-areas:
              "name"
              "light"
              "climate"
              "meter"
              "plug";
          }
          h2 { font-size: 26px; }
          .reading { font-size: 48px; }
          .meter-value, .plug-power { font-size: 26px; }
        }
      `;

      const card = document.createElement("ha-card");
      const layout = document.createElement("div");
      layout.className = "layout";

      const nameWrap = document.createElement("div");
      nameWrap.className = "name-wrap";
      const nameIcon = document.createElement("div");
      nameIcon.className = "name-icon";
      nameIcon.append(this._icon("mdi:home"));
      const name = document.createElement("h2");
      nameWrap.append(nameIcon, name);

      const lightButtons = [];
      const firstLight = this._config.lights.find(item => item.entity) || null;
      let lightButton = null;
      if (firstLight) {
        lightButton = document.createElement("button");
        lightButton.type = "button";
        lightButton.className = "light";
        const iconWrap = document.createElement("div");
        iconWrap.className = "light-icon";
        const icon = this._icon(firstLight.icon || "mdi:lightbulb");
        iconWrap.append(icon);
        const copy = document.createElement("div");
        copy.className = "light-copy";
        const label = document.createElement("span");
        label.className = "light-name";
        copy.append(label);
        const toggle = document.createElement("span");
        toggle.className = "switch";
        toggle.setAttribute("aria-hidden", "true");
        lightButton.append(iconWrap, copy, toggle);
        lightButton.addEventListener("click", () => this._toggleLight(firstLight.entity));
        lightButtons.push({ button: lightButton, icon, label, entity: firstLight.entity });
      }

      const climate = document.createElement("section");
      climate.className = "climate";
      const climateBody = document.createElement("div");
      climateBody.className = "climate-body";
      const climateCopy = document.createElement("div");
      climateCopy.className = "climate-copy";
      const climateLabel = document.createElement("p");
      climateLabel.className = "tile-label";
      const climateLabelText = document.createElement("span");
      climateLabelText.textContent = "Termostat";
      climateLabel.append(this._icon("mdi:thermometer"), climateLabelText);
      const measuredReading = document.createElement("p");
      measuredReading.className = "reading";
      const climateValue = document.createElement("span");
      const climateUnit = document.createElement("span");
      climateUnit.className = "unit";
      measuredReading.append(climateValue, climateUnit);
      const setpoint = document.createElement("p");
      setpoint.className = "setpoint";
      const setpointPrefix = document.createElement("span");
      setpointPrefix.textContent = "Zadana ";
      const setpointStrong = document.createElement("strong");
      const targetValue = document.createElement("span");
      const targetUnit = document.createElement("span");
      setpointStrong.append(targetValue, targetUnit);
      setpoint.append(setpointPrefix, setpointStrong);
      climateCopy.append(climateLabel, measuredReading, setpoint);
      const controls = document.createElement("div");
      controls.className = "controls";
      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "step";
      plus.textContent = "+";
      plus.setAttribute("aria-label", "Podnieś temperaturę zadaną");
      plus.addEventListener("click", () => this._nudge(1));
      const heatBadge = document.createElement("div");
      heatBadge.className = "heat-badge";
      heatBadge.append(this._radiatorIcon());
      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "step";
      minus.textContent = "−";
      minus.setAttribute("aria-label", "Obniż temperaturę zadaną");
      minus.addEventListener("click", () => this._nudge(-1));
      controls.append(plus, heatBadge, minus);
      climateBody.append(climateCopy, controls);
      climate.append(climateBody);

      const meter = document.createElement("section");
      meter.className = "tile meter";
      const meterIcon = document.createElement("div");
      meterIcon.className = "meter-icon";
      meterIcon.append(this._icon("mdi:thermometer"));
      const meterCopy = document.createElement("div");
      meterCopy.className = "meter-copy";
      const meterLabel = document.createElement("p");
      meterLabel.className = "plug-name";
      meterLabel.textContent = "Termometr";
      const meterSub = document.createElement("p");
      meterSub.className = "plug-sub";
      meterCopy.append(meterLabel, meterSub);
      const meterValueWrap = document.createElement("p");
      meterValueWrap.className = "meter-value";
      const thermometerValue = document.createElement("span");
      const thermometerUnit = document.createElement("span");
      thermometerUnit.className = "unit";
      meterValueWrap.append(thermometerValue, thermometerUnit);
      meter.append(meterIcon, meterCopy, meterValueWrap);

      // Read-only on purpose: the plug reports state and power, it is not a switch.
      const plug = document.createElement("div");
      plug.className = "tile plug";
      plug.setAttribute("role", "group");
      const plugIconWrap = document.createElement("div");
      plugIconWrap.className = "plug-icon";
      plugIconWrap.append(this._icon("mdi:power-plug"));
      const plugCopy = document.createElement("div");
      plugCopy.className = "plug-copy";
      const plugName = document.createElement("p");
      plugName.className = "plug-name";
      plugName.textContent = "Gniazdko";
      const plugSub = document.createElement("p");
      plugSub.className = "plug-sub";
      plugCopy.append(plugName, plugSub);
      const plugPower = document.createElement("p");
      plugPower.className = "plug-power";
      plug.append(plugIconWrap, plugCopy, plugPower);

      const empty = document.createElement("p");
      empty.className = "empty";
      const status = document.createElement("p");
      status.className = "status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");

      layout.append(nameWrap);
      if (lightButton) layout.append(lightButton);
      layout.append(climate, meter, plug, empty, status);
      card.append(layout);
      this.shadowRoot.replaceChildren(style, card);
      this._ui = {
        card, layout, name, empty,
        climate, climateValue, climateUnit, setpoint, targetValue, targetUnit,
        minus, plus, heatBadge,
        meter, thermometerValue, thermometerUnit, meterSub,
        plug, plugName, plugSub, plugPower,
        lightButton, lightButtons, status,
      };
    }

    _update() {
      if (!this._ui || !this._config) return;
      const ui = this._ui;
      ui.name.textContent = this._config.name;
      const showThermometer = !!this._config.thermometer;
      const showThermostat = !!(this._config.climate || this._config.climate_temperature);
      const showPlug = !!(this._config.plug || this._config.power);
      const showLight = ui.lightButtons.length > 0;
      const configured = showThermometer || showThermostat || showPlug || showLight;
      setHidden(ui.empty, configured);
      ui.empty.textContent = "Wybierz encje w konfiguracji karty.";
      setHidden(ui.meter, !showThermometer);
      setHidden(ui.climate, !showThermostat);
      if (ui.lightButton) setHidden(ui.lightButton, !showLight);
      ui.layout.className = "layout";
      ui.layout.classList.toggle("no-light", !showLight);
      ui.layout.classList.toggle("no-meter", !showThermometer);
      ui.layout.classList.toggle("no-plug", !showPlug);
      ui.layout.classList.toggle("no-climate", !showThermostat);

      if (showThermometer) this._updateThermometer();
      if (showThermostat) this._updateThermostat();
      else ui.card.classList.toggle("heating-glow", false);
      this._updatePlug(showPlug);
      this._updateLights();

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
      ui.meterSub.textContent = unavailable ? "Niedostępny" : (this._friendly(entity, "") || "W pokoju");
      ui.meter.setAttribute("aria-label", unavailable
        ? "Termometr niedostępny"
        : `Termometr ${ui.thermometerValue.textContent} ${ui.thermometerUnit.textContent}`.trim());
    }

    _currentTemperature() {
      if (this._config.climate_temperature) {
        if (this._unavailable(this._config.climate_temperature)) return null;
        return this._numericState(this._config.climate_temperature);
      }
      if (!this._config.climate || this._unavailable(this._config.climate)) return null;
      const value = Number(this._state(this._config.climate)?.attributes?.current_temperature);
      return Number.isFinite(value) ? value : null;
    }

    _updateThermostat() {
      const ui = this._ui;
      const hasClimate = !!this._config.climate;
      const unavailable = hasClimate && this._unavailable(this._config.climate);
      const current = this._currentTemperature();
      const unit = this._config.climate_temperature
        ? this._unit(this._config.climate_temperature)
        : this._unit(this._config.climate);
      this._setReading(ui.climateValue, ui.climateUnit, current, unit);

      const range = hasClimate ? this._rangeTarget() : null;
      const target = hasClimate ? this._displayedTarget() : null;
      setHidden(ui.setpoint, !hasClimate);
      if (target != null) this._setReading(ui.targetValue, ui.targetUnit, target, this._unit(this._config.climate));
      else if (range) {
        ui.targetValue.textContent = `${this._formatNumber(range.low, this._digits())}–${this._formatNumber(range.high, this._digits())}`;
        ui.targetUnit.textContent = this._unit(this._config.climate);
      } else this._setReading(ui.targetValue, ui.targetUnit, null, "");

      const action = hasClimate ? this._action() : { label: "", kind: "" };
      const heating = hasClimate && !unavailable && action.kind === "heat";
      ui.climate.className = "climate";
      ui.climate.classList.toggle("heating", heating);
      ui.card.classList.toggle("heating-glow", heating);
      ui.heatBadge.title = !hasClimate ? "" : unavailable ? "Niedostępny" : action.label;
      const { min, max } = this._bounds();
      ui.minus.disabled = !this._canAdjustTemp() || target == null || target <= min + 0.001;
      ui.plus.disabled = !this._canAdjustTemp() || target == null || target >= max - 0.001;
      ui.climate.setAttribute("aria-label", [
        current == null ? "Temperatura termostatu niedostępna" : `Temperatura ${ui.climateValue.textContent} ${ui.climateUnit.textContent}`,
        hasClimate ? `Zadana ${ui.targetValue.textContent} ${ui.targetUnit.textContent}` : "",
        heating ? "Grzeje" : "",
      ].filter(Boolean).join(". "));
    }

    _updatePlug(show) {
      const ui = this._ui;
      setHidden(ui.plug, !show);
      if (!show) return;
      const entity = this._config.plug;
      const unavailable = entity ? this._unavailable(entity) : false;
      const on = !!entity && !unavailable && this._state(entity)?.state === "on";
      ui.plug.className = "tile plug";
      ui.plug.classList.toggle("on", on);
      ui.plugName.textContent = "Gniazdko";
      ui.plugSub.textContent = !entity ? "Pobór mocy" : unavailable ? "Niedostępne" : "Pobór mocy";
      const power = this._powerReading();
      ui.plugPower.textContent = power || "—";
      setHidden(ui.plugPower, !power && !entity);
      ui.plug.setAttribute("aria-label", ["Gniazdko", ui.plugSub.textContent, power].filter(Boolean).join(", "));
    }

    _updateLights() {
      let anyOn = false;
      for (const item of this._ui.lightButtons) {
        const on = this._lightOn(item.entity);
        anyOn = anyOn || on;
        const unavailable = this._unavailable(item.entity);
        const light = this._config.lights.find(entry => entry.entity === item.entity);
        item.button.setAttribute("aria-pressed", String(on));
        item.button.disabled = !this._interactive() || unavailable || this._lightFlight.has(item.entity);
        item.icon.setAttribute("icon", light?.icon || "mdi:lightbulb");
        item.label.textContent = this._lightName(light) || "Światło";
      }
      this._ui.card.classList.toggle("lit", anyOn);
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
      return { label: mode || "", kind: mode === "cool" ? "cool" : mode === "heat" ? "heat" : "" };
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
      this._entityField(general, "Temperatura termostatu", "sensor", this._config.climate_temperature, value => this._commit(config => { config.climate_temperature = value; }), "temperature");
      this._entityField(general, "Termometr w pokoju", "sensor", this._config.thermometer, value => this._commit(config => { config.thermometer = value; }), "temperature");
      const climateHelp = document.createElement("p");
      climateHelp.className = "help";
      climateHelp.textContent = "Termometr w pokoju to czujnik w pomieszczeniu. Temperatura termostatu to pomiar z samego urządzenia, na przykład sensor.0x…_local_temperature. Zadana temperatura zostaje osobno.";
      general.append(climateHelp);
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
/** Powiedz w domu — głośniki, gotowe komunikaty i własna wiadomość przez skrypt HA. */
(() => {
  const TAG = "powiedz-w-domu-card";
  if (customElements.get(TAG)) return;

  const SPEAKERS = 3;
  const PRESETS = 10;
  const LIMIT = 1000;
  const ENTITY = /^media_player\.[a-z0-9_]+$/;
  const SCRIPT = /^script\.[a-z0-9_]+$/;
  const DEFAULT_PRESETS = [
    "Obiad gotowy. Zapraszam do stołu!",
    "Wychodzimy za pięć minut. Przygotujcie się!",
    "Proszę, przyjdźcie na chwilę do salonu.",
    "Czas spać. Dobranoc!",
  ];
  const DEFAULT_SPEAKERS = [
    { entity: "", name: "Salon", icon: "mdi:sofa" },
    { entity: "", name: "Kuchnia", icon: "mdi:pot-steam" },
    { entity: "", name: "", icon: "mdi:speaker" },
  ];

  class PowiedzWDomuCard extends HTMLElement {
    static getConfigElement() {
      return document.createElement("powiedz-w-domu-editor");
    }

    static getStubConfig() {
      return {
        title: "Powiedz w domu", script: "", language: "pl-PL", show_dictation: true,
        speakers: DEFAULT_SPEAKERS.map(speaker => ({ ...speaker })),
        presets: Array.from({ length: PRESETS }, (_, index) => ({ text: DEFAULT_PRESETS[index] || "" })),
      };
    }

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._text = "";
      this._custom = false;
      this._selected = new Set();
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
      const next = this._normalize(config);
      this._cancelRecognition();
      this._revision += 1;
      this._config = next;
      this._selected = new Set(next.speakers.filter(speaker => speaker.selected).map(speaker => speaker.entity));
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
    getCardSize() { return 8; }
    getGridOptions() { return { columns: 12, rows: "auto", min_columns: 6 }; }

    _normalize(config) {
      const speakers = config.speakers == null ? DEFAULT_SPEAKERS : config.speakers;
      if (!Array.isArray(speakers)) throw new Error("Pole speakers musi być listą.");
      if (speakers.length > SPEAKERS) throw new Error("Możesz skonfigurować maksymalnie 3 głośniki.");
      const declared = speakers.some(speaker => speaker && Object.prototype.hasOwnProperty.call(speaker, "selected"));
      let picked = false;
      const normalizedSpeakers = speakers.map((speaker, index) => {
        if (!speaker || typeof speaker !== "object" || Array.isArray(speaker)) {
          throw new Error("Każdy głośnik musi być obiektem z polem entity.");
        }
        const entity = speaker.entity == null || speaker.entity === "" ? "" : String(speaker.entity);
        if (entity && !ENTITY.test(entity)) throw new Error("Głośnik musi być encją media_player.");
        let selected = declared ? speaker.selected === true : false;
        if (!declared && entity && !picked) { selected = true; picked = true; }
        return {
          entity,
          name: speaker.name == null ? String(DEFAULT_SPEAKERS[index]?.name || "") : String(speaker.name).trim().slice(0, 60),
          icon: String(speaker.icon || DEFAULT_SPEAKERS[index]?.icon || "mdi:speaker").trim().slice(0, 80) || "mdi:speaker",
          selected: selected && !!entity,
        };
      });
      const chosen = normalizedSpeakers.map(speaker => speaker.entity).filter(Boolean);
      if (new Set(chosen).size !== chosen.length) throw new Error("Każdy głośnik musi być inną encją.");

      const presets = config.presets == null ? DEFAULT_PRESETS.map(text => ({ text })) : config.presets;
      if (!Array.isArray(presets)) throw new Error("Pole presets musi być listą.");
      if (presets.length > PRESETS) throw new Error("Możesz skonfigurować maksymalnie 10 komunikatów.");
      const normalizedPresets = Array.from({ length: PRESETS }, (_, index) => {
        const preset = presets[index];
        if (preset == null) return { text: "" };
        if (typeof preset !== "object" || Array.isArray(preset)) {
          throw new Error("Każdy komunikat musi być obiektem z polem text.");
        }
        const value = preset.text != null && preset.text !== "" ? preset.text : preset.label;
        if (value == null || value === "") return { text: "" };
        if (typeof value !== "string" || value.length > LIMIT) {
          throw new Error("Każdy komunikat musi mieć pole text (maks. 1000 znaków).");
        }
        return { text: value };
      });
      return {
        title: String(config.title ?? "Powiedz w domu").trim().slice(0, 80) || "Powiedz w domu",
        script: config.script || "",
        language: String(config.language ?? "pl-PL"),
        show_dictation: config.show_dictation !== false,
        speakers: normalizedSpeakers,
        presets: normalizedPresets,
      };
    }

    _icon(name) {
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", name);
      icon.setAttribute("aria-hidden", "true");
      return icon;
    }

    _build() {
      const style = document.createElement("style");
      style.textContent = `
        :host { display: block; color: var(--primary-text-color); }
        * { box-sizing: border-box; }
        ha-card { container-type: inline-size; display: block; overflow: hidden; }
        header { display: flex; gap: 12px; align-items: center; padding: 22px 22px 8px; }
        .brand { display: grid; place-items: center; width: 44px; height: 44px; flex: none;
          border-radius: 14px; color: var(--primary-color); background: var(--secondary-background-color); }
        h2 { margin: 0; font-size: 21px; font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }
        .content { display: flex; flex-direction: column; gap: 10px; padding: 8px 22px 22px; }
        button, textarea { font: inherit; }
        button { cursor: pointer; color: var(--primary-text-color); }
        button:disabled { cursor: default; opacity: .55; }
        button:focus-visible, textarea:focus-visible { outline: 3px solid var(--primary-color); outline-offset: 3px; }
        .speakers { display: grid; grid-template-columns: 1fr; gap: 10px; }
        .speakers.cols-2 { grid-template-columns: 1fr 1fr; }
        .speakers.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
        .speaker { display: flex; align-items: center; gap: 9px; text-align: left; min-height: 64px; min-width: 0;
          padding: 12px; border: 1px solid var(--divider-color); border-radius: 13px; background: var(--card-background-color); }
        .speaker[aria-pressed=true] { border-color: var(--primary-color); background: var(--secondary-background-color); }
        .speaker[aria-pressed=true] ha-icon { color: var(--primary-color); }
        .speaker-copy { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
        .speaker-name { font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
        .speaker-state { font-size: 11px; color: var(--secondary-text-color); }
        .check { width: 18px; height: 18px; border: 1.5px solid var(--secondary-text-color); border-radius: 5px; flex: none; display: grid; place-items: center; }
        .check::after { content: ""; width: 8px; height: 5px; border-left: 2px solid transparent; border-bottom: 2px solid transparent; transform: rotate(-45deg) translateY(-1px); }
        .speaker[aria-pressed=true] .check { border-color: var(--primary-color); background: var(--primary-color); }
        .speaker[aria-pressed=true] .check::after { border-color: var(--text-primary-color, #fff); }
        .presets { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .preset { display: inline-flex; align-items: center; width: fit-content; max-width: 100%; min-height: 44px; text-align: left;
          border: 1px solid var(--divider-color); border-radius: 12px; background: var(--secondary-background-color); padding: 10px 14px; font-size: 14px; }
        .preset span { overflow-wrap: anywhere; min-width: 0; }
        .preset[aria-pressed=true] { border-color: var(--primary-color); background: var(--card-background-color); color: var(--primary-color); }
        .composer { display: flex; flex-direction: column; gap: 8px; }
        .editor { border: 1px solid var(--divider-color); border-radius: 12px; overflow: hidden; }
        .editor:focus-within { border-color: var(--primary-color); }
        textarea { display: block; width: 100%; min-height: 96px; resize: vertical; padding: 13px 14px 6px;
          border: 0; background: var(--card-background-color); color: var(--primary-text-color); font-size: 16px; line-height: 1.6; }
        textarea::placeholder { color: var(--secondary-text-color); opacity: 1; }
        .editor-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; }
        .dictate { display: flex; align-items: center; gap: 6px; min-height: 40px; padding: 6px 10px;
          border: 0; border-radius: 8px; color: var(--primary-color); background: var(--secondary-background-color); font-size: 13px; }
        .dictate[aria-pressed=true] { color: var(--error-color); }
        .count { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--secondary-text-color); }
        .speech-help { font-size: 12px; line-height: 1.5; color: var(--secondary-text-color); margin: 0; }
        ha-icon { --mdc-icon-size: 20px; flex: none; }
        .send { display: flex; justify-content: center; align-items: center; gap: 9px; width: 100%; min-height: 48px;
          border: 0; border-radius: 12px; padding: 12px; font-size: 15px; font-weight: 500;
          background: var(--primary-color); color: var(--text-primary-color, #fff); }
        .status { font-size: 12px; line-height: 1.5; text-align: center; color: var(--secondary-text-color); overflow-wrap: anywhere; }
        .status.error { color: var(--error-color); }
        [hidden] { display: none !important; }
        @container (max-width: 460px) {
          .speakers.cols-2, .speakers.cols-3 { grid-template-columns: 1fr; }
          header { padding: 20px 16px 8px; }
          .content { padding: 8px 16px 20px; }
        }
        @media (pointer: coarse) { .preset, .dictate, .speaker { min-height: 44px; } }
      `;
      const card = document.createElement("ha-card");
      const header = document.createElement("header");
      const brand = document.createElement("div");
      brand.className = "brand";
      brand.append(this._icon("mdi:bullhorn-outline"));
      const heading = document.createElement("h2");
      header.append(brand, heading);
      const content = document.createElement("div");
      content.className = "content";
      const speakers = document.createElement("div");
      speakers.className = "speakers";
      speakers.setAttribute("role", "group");
      speakers.setAttribute("aria-label", "Głośniki");
      const presets = document.createElement("div");
      presets.className = "presets";
      presets.setAttribute("role", "group");
      presets.setAttribute("aria-label", "Komunikaty");
      const composer = document.createElement("div");
      composer.className = "composer";
      const editor = document.createElement("div");
      editor.className = "editor";
      const text = document.createElement("textarea");
      text.rows = 3;
      text.maxLength = LIMIT;
      text.placeholder = "Własna wiadomość";
      text.setAttribute("aria-label", "Własna wiadomość");
      const footer = document.createElement("div");
      footer.className = "editor-footer";
      const mic = document.createElement("button");
      mic.type = "button";
      mic.className = "dictate";
      mic.setAttribute("aria-pressed", "false");
      const micIcon = this._icon("mdi:microphone");
      const micLabel = document.createElement("span");
      micLabel.textContent = "Dyktuj";
      mic.append(micIcon, micLabel);
      const count = document.createElement("span");
      count.className = "count";
      footer.append(mic, count);
      const help = document.createElement("p");
      help.className = "speech-help";
      const send = document.createElement("button");
      send.type = "button";
      send.className = "send";
      const sendIcon = this._icon("mdi:play");
      const sendLabel = document.createElement("span");
      send.append(sendIcon, sendLabel);
      editor.append(text, footer);
      composer.append(editor, help, send);
      const status = document.createElement("p");
      status.className = "status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      content.append(speakers, presets, composer, status);
      card.append(header, content);
      this.shadowRoot.replaceChildren(style, card);

      heading.textContent = this._config.title;
      text.value = this._text;
      const visibleSpeakers = this._config.speakers.filter(speaker => speaker.entity);
      speakers.classList.toggle("cols-2", visibleSpeakers.length === 2);
      speakers.classList.toggle("cols-3", visibleSpeakers.length >= 3);
      speakers.hidden = !visibleSpeakers.length;
      const speakerUi = visibleSpeakers.map(speaker => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "speaker";
        const copy = document.createElement("div");
        copy.className = "speaker-copy";
        const name = document.createElement("span");
        name.className = "speaker-name";
        const state = document.createElement("span");
        state.className = "speaker-state";
        copy.append(name, state);
        const check = document.createElement("span");
        check.className = "check";
        check.setAttribute("aria-hidden", "true");
        button.append(this._icon(speaker.icon), copy, check);
        button.addEventListener("click", () => {
          if (this._selected.has(speaker.entity)) this._selected.delete(speaker.entity);
          else this._selected.add(speaker.entity);
          this._notice = "";
          this._update();
        });
        speakers.append(button);
        return { button, speaker, name, state };
      });
      const presetUi = [];
      for (const preset of this._config.presets) {
        if (!preset.text.trim()) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "preset";
        const label = document.createElement("span");
        label.textContent = preset.text;
        button.append(label);
        button.addEventListener("click", () => this._speak(preset.text));
        presets.append(button);
        presetUi.push({ button, text: preset.text });
      }
      const custom = document.createElement("button");
      custom.type = "button";
      custom.className = "preset";
      const customLabel = document.createElement("span");
      customLabel.textContent = "Własny komunikat";
      custom.append(customLabel);
      custom.addEventListener("click", () => {
        this._custom = !this._custom;
        this._notice = "";
        if (!this._custom) this._cancelRecognition();
        this._update();
        if (this._custom) text.focus();
      });
      presets.append(custom);
      text.addEventListener("input", () => {
        this._text = text.value;
        this._notice = "";
        this._update();
      });
      mic.addEventListener("click", () => this._toggleDictation());
      send.addEventListener("click", () => this._send());
      this._ui = {
        text, count, mic, micLabel, micIcon, help, send, sendLabel, status,
        composer, custom, speakers: speakerUi, presets: presetUi,
      };
    }

    _name(speaker) {
      return speaker?.name || this._hass?.states?.[speaker?.entity]?.attributes?.friendly_name || speaker?.entity || "Głośnik";
    }

    _unavailable(entity) {
      const state = this._hass?.states?.[entity]?.state;
      return !state || state === "unavailable" || state === "unknown";
    }

    _chosen() {
      return this._config.speakers.filter(speaker => speaker.entity && this._selected.has(speaker.entity));
    }

    _targets() {
      return this._chosen().filter(speaker => !this._unavailable(speaker.entity));
    }

    _problem(raw = this._text) {
      const text = String(raw ?? "");
      if (this.preview) return "Podgląd karty — wysyłanie jest wyłączone.";
      if (!this._config.script || !this._config.speakers.some(speaker => speaker.entity)) {
        return "W edytorze karty wybierz skrypt i co najmniej jeden głośnik.";
      }
      if (!this._hass || this._hass.connected === false) return "Brak połączenia z Home Assistant.";
      if (this._unavailable(this._config.script)) return "Skrypt jest niedostępny. Sprawdź jego identyfikator w konfiguracji karty.";
      const chosen = this._chosen();
      if (!chosen.length) return "Wybierz co najmniej jeden głośnik.";
      if (chosen.every(speaker => this._unavailable(speaker.entity))) return "Wybrany głośnik jest niedostępny.";
      if (!text.trim()) return "Wpisz tekst lub wybierz gotową wiadomość.";
      if (text.length > LIMIT) return "Wiadomość może mieć maksymalnie 1000 znaków.";
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
      ui.composer.hidden = !this._custom;
      ui.custom.setAttribute("aria-pressed", String(this._custom));
      ui.custom.disabled = locked;
      ui.speakers.forEach(({ button, speaker, name, state }) => {
        const missing = this._unavailable(speaker.entity);
        const pressed = this._selected.has(speaker.entity);
        button.setAttribute("aria-pressed", String(pressed));
        button.disabled = locked || missing || this._hass?.connected === false;
        name.textContent = this._name(speaker);
        state.textContent = !this._hass || this._hass.connected === false ? "Brak połączenia" : missing ? "Niedostępny" : "Dostępny";
      });
      ui.presets.forEach(item => {
        const button = item.button ?? item;
        button.disabled = locked;
      });
      const speechProblem = this._speechProblem();
      ui.mic.disabled = this._sending || !!speechProblem || !!this._stopping;
      ui.mic.hidden = !this._config.show_dictation;
      ui.mic.setAttribute("aria-pressed", String(listening));
      ui.micLabel.textContent = this._stopping ? "Kończenie…" : listening ? "Zakończ" : "Dyktuj";
      ui.micIcon.setAttribute("icon", listening ? "mdi:stop" : "mdi:microphone");
      ui.help.textContent = speechProblem || "";
      ui.help.hidden = !speechProblem || !this._config.show_dictation;
      ui.send.disabled = locked || !!this._problem(this._text);
      ui.sendLabel.textContent = this._sending ? "Wysyłanie…" : "Odtwórz";
      const problem = this._problem(this._text);
      const quiet = !String(this._text || "").trim();
      const status = this._notice || (this._custom && problem && !quiet ? problem : "");
      ui.status.textContent = status;
      ui.status.hidden = !status;
      ui.status.classList.toggle("error", !!this._notice && this._noticeError);
    }

    _setNotice(text, error = false) {
      this._notice = text;
      this._noticeError = error;
      this._update();
    }

    async _speak(raw) {
      if (this._sending || this._recognition) return;
      const problem = this._problem(raw);
      if (problem) { this._setNotice(problem, true); return; }
      const text = String(raw).trim();
      const targets = this._targets();
      const revision = this._revision;
      this._sending = true;
      this._setNotice("Wysyłanie wiadomości…");
      const names = targets.map(speaker => this._name(speaker));
      try {
        if (revision !== this._revision) return;
        await this._hass.callService("script", this._config.script.slice(7), {
          tekst: text,
          glosniki: targets.map(speaker => speaker.entity),
        });
        if (revision === this._revision) {
          const label = names.length === 1 ? "głośnika" : "głośników";
          this._setNotice(`Wysłano do ${label}: ${names.join(", ")}.`);
        }
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

    _send() { return this._speak(this._text); }

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
    description: "Do trzech głośników, gotowe komunikaty i własna wiadomość.",
  });
})();
;

// Source: src/cards/powiedz-w-domu/editor.js
(() => {
  const TAG = "powiedz-w-domu-editor";
  if (customElements.get(TAG)) return;
  const SPEAKERS = 3;
  const PRESETS = 10;

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
      const incoming = config || {};
      this._config = { ...defaults, ...HaCardKit.clone(incoming) };
      const incomingSpeakers = Array.isArray(incoming.speakers) ? incoming.speakers : [];
      const declared = incomingSpeakers.some(speaker => speaker && Object.prototype.hasOwnProperty.call(speaker, "selected"));
      const firstEntity = incomingSpeakers.findIndex(speaker => speaker?.entity);
      this._config.speakers = Array.from({ length: SPEAKERS }, (_, index) => {
        const item = incomingSpeakers[index] || {};
        const fallback = defaults.speakers[index];
        return {
          entity: item.entity || "",
          name: item.name == null ? fallback.name : String(item.name),
          icon: item.icon || fallback.icon,
          selected: declared ? item.selected === true : index === firstEntity,
        };
      });
      const incomingPresets = Array.isArray(incoming.presets) ? incoming.presets : defaults.presets;
      this._config.presets = Array.from({ length: PRESETS }, (_, index) => {
        const item = incomingPresets[index] || {};
        const text = item.text != null && item.text !== "" ? item.text : item.label;
        return { text: text == null ? "" : String(text).slice(0, 1000) };
      });
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

    _switch(parent, labelText, checked, onChange) {
      const label = document.createElement("label");
      label.className = "switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = checked;
      input.addEventListener("change", () => onChange(input.checked));
      const caption = document.createElement("span");
      caption.textContent = labelText;
      label.append(input, caption);
      parent.append(label);
    }

    _entityField(parent, labelText, domain, value, onChange) {
      const label = document.createElement("label"); label.className = "field";
      const caption = document.createElement("span"); caption.textContent = labelText;
      const select = document.createElement("select");
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
          input, textarea, select, button { font: inherit; color: var(--primary-text-color); }
          input, textarea, select { width: 100%; min-width: 0; min-height: 42px; padding: 9px; border: 1px solid var(--divider-color); border-radius: 8px; background: var(--card-background-color); font-size: 16px; }
          textarea { resize: vertical; }
          fieldset { margin: 0; border: 1px solid var(--divider-color); border-radius: 10px; padding: 14px; min-width: 0; display: grid; gap: 12px; }
          legend { font-size: 14px; font-weight: 500; padding: 0 6px; }
          .help { color: var(--secondary-text-color); font-size: 12px; line-height: 1.6; margin: 0; }
          .switch { display: flex; align-items: center; gap: 8px; font-size: 14px; }
          .switch input { width: 18px; min-height: 18px; }
          .slots { display: grid; gap: 12px; }
          button { min-height: 40px; padding: 8px 12px; background: var(--secondary-background-color); border: 1px solid var(--divider-color); border-radius: 8px; cursor: pointer; }
          button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
          h3 { font-size: 15px; font-weight: 500; margin: 0; }
          @media (max-width: 420px) { .grid { grid-template-columns: 1fr; } }
        </style>
        <div class="form">
          <div class="general"></div>
          <h3>Głośniki</h3>
          <p class="help speaker-help"></p>
          <div class="speakers slots"></div>
          <div class="speech-settings"></div>
          <h3>Komunikaty</h3>
          <p class="help preset-help"></p>
          <div class="presets slots"></div>
        </div>`;
      const q = selector => this.shadowRoot.querySelector(selector);
      const general = q(".general");
      this._textField(general, "Tytuł karty", this._config.title, value => this._commit(c => { c.title = value; }));
      this._entityField(general, "Skrypt odtwarzania", "script", this._config.script, value => this._commit(c => { c.script = value; }));
      const help = document.createElement("p");
      help.className = "help";
      help.textContent = "Skrypt dostaje tekst i listę glosniki. Jedno wywołanie czyta wiadomość na wszystkich zaznaczonych głośnikach. Wklej examples/powiedz-w-domu-script.yaml i podmień encję TTS.";
      general.append(help);
      q(".speaker-help").textContent = "Trzy sloty. Pusty nie pojawia się na karcie. Można zaznaczyć kilka głośników naraz. „Zaznaczony domyślnie” włącza głośnik po otwarciu karty.";
      this._config.speakers.forEach((speaker, index) => {
        const fieldset = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.textContent = `Głośnik ${index + 1}`;
        fieldset.append(legend);
        this._entityField(fieldset, "Encja głośnika", "media_player", speaker.entity, value => this._commit(c => { c.speakers[index].entity = value; }));
        const grid = document.createElement("div");
        grid.className = "grid";
        this._textField(grid, "Nazwa na karcie", speaker.name, value => this._commit(c => { c.speakers[index].name = value; }));
        this._textField(grid, "Ikona (np. mdi:speaker)", speaker.icon, value => this._commit(c => { c.speakers[index].icon = value; }));
        fieldset.append(grid);
        this._switch(fieldset, "Zaznaczony domyślnie", speaker.selected === true, value => this._commit(c => { c.speakers[index].selected = value; }));
        q(".speakers").append(fieldset);
      });
      const speech = q(".speech-settings");
      this._switch(speech, "Pokaż przycisk dyktowania", this._config.show_dictation !== false, value => this._commit(c => { c.show_dictation = value; }));
      this._textField(speech, "Język dyktowania", this._config.language, value => this._commit(c => { c.language = value; }));
      const speechHelp = document.createElement("p");
      speechHelp.className = "help";
      speechHelp.textContent = "Dyktowanie pojawia się po wybraniu własnego komunikatu. Korzysta z przeglądarki, może używać chmury i wymaga HTTPS. Nie zmienia głosu TTS.";
      speech.append(speechHelp);
      q(".preset-help").textContent = "Dziesięć slotów, jedno pole tekstu. Pusty slot nie pojawia się na karcie. Kliknięcie odtwarza ten tekst. Na karcie jest też własny komunikat z polem do wpisania.";
      this._config.presets.forEach((preset, index) => {
        const fieldset = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.textContent = `Komunikat ${index + 1}`;
        fieldset.append(legend);
        this._textField(fieldset, "Tekst", preset.text, value => this._commit(c => { c.presets[index].text = value; }), { multiline: true, limit: 1000 });
        q(".presets").append(fieldset);
      });
      this._updateOptions();
    }
  }

  customElements.define(TAG, AnnouncementEditor);
})();
;
})();
