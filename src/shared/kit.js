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
