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
