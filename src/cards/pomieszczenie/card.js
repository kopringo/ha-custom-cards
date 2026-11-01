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
        .setpoint { display: block; }
        .setpoint-label { margin: 12px 0 0; }
        .thermostat.with-measure .setpoint { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; }
        .thermostat.with-measure .target-reading { margin-top: 2px; font-size: 22px; }
        .thermostat.with-measure .stepper { margin-top: 0; }
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
      thermometerKicker.textContent = "W pokoju";
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
      const measured = document.createElement("div");
      measured.className = "measured";
      const measuredReading = document.createElement("p");
      measuredReading.className = "reading";
      const climateValue = document.createElement("span");
      const climateUnit = document.createElement("span");
      climateUnit.className = "unit";
      measuredReading.append(climateValue, climateUnit);
      const climateSub = document.createElement("p");
      climateSub.className = "sub";
      measured.append(measuredReading, climateSub);
      const setpoint = document.createElement("div");
      setpoint.className = "setpoint";
      const setpointCopy = document.createElement("div");
      const setpointLabel = document.createElement("p");
      setpointLabel.className = "kicker setpoint-label";
      setpointLabel.textContent = "Zadana";
      const targetReading = document.createElement("p");
      targetReading.className = "reading target-reading";
      const targetValue = document.createElement("span");
      const targetUnit = document.createElement("span");
      targetUnit.className = "unit";
      targetReading.append(targetValue, targetUnit);
      setpointCopy.append(setpointLabel, targetReading);
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
      setpoint.append(setpointCopy, stepper);
      const modes = document.createElement("div");
      modes.className = "modes";
      modes.setAttribute("role", "group");
      modes.setAttribute("aria-label", "Tryb termostatu");
      thermostat.append(thermoTop, measured, setpoint, modes);
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
        thermostat, thermostatKicker, measured, climateValue, climateUnit, climateSub, setpoint, setpointLabel,
        action, targetValue, targetUnit, minus, plus, modes, modeButtons: [],
        plug, plugName, plugState, plugPower, lights, lightButtons, status,
      };
    }

    _update() {
      if (!this._ui || !this._config) return;
      const ui = this._ui;
      ui.name.textContent = this._config.name;
      const showThermometer = !!this._config.thermometer;
      const showThermostat = !!(this._config.climate || this._config.climate_temperature);
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
        ? "Temperatura w pokoju niedostępna"
        : `Temperatura w pokoju ${ui.thermometerValue.textContent} ${ui.thermometerUnit.textContent}`.trim());
    }

    _updateThermostat() {
      const ui = this._ui;
      const hasClimate = !!this._config.climate;
      const unavailable = hasClimate && this._unavailable(this._config.climate);
      const showMeasure = !!this._config.climate_temperature;
      setHidden(ui.measured, !showMeasure);
      setHidden(ui.setpoint, !hasClimate);
      setHidden(ui.setpointLabel, !showMeasure);
      ui.thermostat.className = "tile thermostat";
      ui.thermostat.classList.toggle("with-measure", showMeasure);
      ui.thermostatKicker.textContent = showMeasure ? "Termostat" : "Zadana";
      if (showMeasure) {
        const sensor = this._config.climate_temperature;
        const sensorDown = this._unavailable(sensor);
        this._setReading(ui.climateValue, ui.climateUnit, sensorDown ? null : this._numericState(sensor), this._unit(sensor));
        ui.climateSub.textContent = sensorDown ? "Niedostępny" : this._friendly(sensor, "");
      }
      const range = hasClimate ? this._rangeTarget() : null;
      const target = hasClimate ? this._displayedTarget() : null;
      if (target != null) this._setReading(ui.targetValue, ui.targetUnit, target, this._unit(this._config.climate));
      else if (range) {
        ui.targetValue.textContent = `${this._formatNumber(range.low, this._digits())}–${this._formatNumber(range.high, this._digits())}`;
        ui.targetUnit.textContent = this._unit(this._config.climate);
      } else this._setReading(ui.targetValue, ui.targetUnit, null, "");
      const action = hasClimate ? this._action() : { label: "", kind: "" };
      ui.action.textContent = !hasClimate ? "" : unavailable ? "Niedostępny" : action.label;
      ui.action.className = "action";
      if (hasClimate && !unavailable && action.kind) ui.action.classList.toggle(action.kind, true);
      const { min, max } = this._bounds();
      ui.minus.disabled = !this._canAdjustTemp() || target == null || target <= min + 0.001;
      ui.plus.disabled = !this._canAdjustTemp() || target == null || target >= max - 0.001;
      const measuredText = showMeasure ? `Pomiar termostatu ${ui.climateValue.textContent} ${ui.climateUnit.textContent}. ` : "";
      ui.thermostat.setAttribute("aria-label", `${measuredText}Temperatura zadana ${ui.targetValue.textContent} ${ui.targetUnit.textContent}`.trim());
      this._syncModes(!hasClimate || unavailable);
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
