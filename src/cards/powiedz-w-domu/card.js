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
