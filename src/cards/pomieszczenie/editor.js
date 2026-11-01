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
