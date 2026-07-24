// Local, offline icon set as a React-safe custom element <x-ic>.
// Clean geometric line icons (Lucide-style) so no external CDN is needed.
(function () {
  var I = {
    grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    x: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.9 4.9l1.4 1.4"/><path d="M17.7 17.7l1.4 1.4"/><path d="M19.1 4.9l-1.4 1.4"/><path d="M6.3 17.7l-1.4 1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h3l2 2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    wifi: '<path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8 15.7a6 6 0 0 1 8 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
    signal: '<rect x="4" y="16" width="3" height="4" rx="1" fill="currentColor" stroke="none"/><rect x="9" y="12" width="3" height="8" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="8" width="3" height="12" rx="1" fill="currentColor" stroke="none"/><rect x="19" y="4" width="3" height="16" rx="1" fill="currentColor" stroke="none"/>',
    battery: '<rect x="3" y="8" width="16" height="9" rx="2"/><path d="M21 11v3" /><rect x="5.2" y="10.2" width="8.6" height="4.6" rx="1" fill="currentColor" stroke="none"/>',
    warning: '<path d="M12 3l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none"/>',
    gitbranch: '<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="7" r="2.4"/><path d="M6 8.4v7.2"/><path d="M18 9.4c0 4-4 5.1-8.2 5.8"/>',
    activity: '<path d="M3 12h3.5l2.5-7 5 14 2.5-7H21"/>',
    list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><circle cx="3.6" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="3.6" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="3.6" cy="18" r="1" fill="currentColor" stroke="none"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    bug: '<rect x="8.5" y="7" width="7" height="11" rx="3.5"/><path d="M12 7V4.5"/><path d="M10 5.5 8.5 4M14 5.5 15.5 4"/><path d="M8.5 10H5M8.5 14H4.3M8.5 17.5 5.5 19M15.5 10H19M15.5 14h4.2M15.5 17.5 18.5 19"/>',
    doc: '<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/>',
    review: '<circle cx="6" cy="6" r="2.3"/><circle cx="6" cy="18" r="2.3"/><path d="M6 8.3v7.4"/><circle cx="18" cy="18" r="2.3"/><path d="M18 15.7V12a3 3 0 0 0-3-3h-4"/><path d="M13 7l-2 2 2 2"/>',
    brand: '<path d="M6.5 8l4 4-4 4"/><path d="M12.5 17h6"/>'
  };

  class XIc extends HTMLElement {
    static get observedAttributes() { return ['name', 'size', 'sw']; }
    constructor() { super(); this._root = this.attachShadow({ mode: 'open' }); }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { this.render(); }
    render() {
      if (!this._root) return;
      var name = this.getAttribute('name') || 'plus';
      var size = this.getAttribute('size') || '18';
      var sw = this.getAttribute('sw') || '2';
      var inner = I[name] || I.plus;
      this._root.innerHTML =
        '<style>:host{display:inline-flex;align-items:center;justify-content:center;line-height:0;vertical-align:middle}</style>' +
        '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
    }
  }
  if (!customElements.get('x-ic')) customElements.define('x-ic', XIc);
})();
