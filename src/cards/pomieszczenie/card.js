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
