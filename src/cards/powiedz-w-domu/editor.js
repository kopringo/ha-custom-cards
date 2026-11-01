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
      help.textContent = "Skrypt dostaje tekst i glosnik. Karta wywołuje go osobno dla każdego zaznaczonego głośnika. Przykład jest w examples/powiedz-w-domu-script.yaml.";
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
