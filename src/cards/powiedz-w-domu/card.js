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
        .presets { display: flex; flex-direction: column; gap: 8px; }
        .preset { display: flex; align-items: center; width: 100%; min-height: 44px; text-align: left;
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
      const sent = [];
      try {
        for (const speaker of targets) {
          if (revision !== this._revision) return;
          await this._hass.callService("script", this._config.script.slice(7), {
            tekst: text, glosnik: speaker.entity,
          });
          sent.push(this._name(speaker));
        }
        if (revision === this._revision) {
          const label = sent.length === 1 ? "głośnika" : "głośników";
          this._setNotice(`Wysłano do ${label}: ${sent.join(", ")}.`);
        }
      } catch (error) {
        if (revision === this._revision) {
          const detail = typeof error?.message === "string" ? error.message : "Sprawdź połączenie i ślad wykonania skryptu.";
          const prefix = sent.length ? `Wysłano do: ${sent.join(", ")}. ` : "";
          this._setNotice(`${prefix}Nie udało się wysłać. ${detail}`, true);
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
