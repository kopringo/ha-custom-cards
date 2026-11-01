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
