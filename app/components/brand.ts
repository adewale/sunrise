export function brandMarkSvgContent() {
  return `<rect class="sky" width="64" height="64" rx="16"/><path class="tray" d="M12 38h40l-4 12H16z"/><path class="line" d="M20 44h24"/><circle class="sun" cx="28" cy="31" r="11"/><path class="ray" d="M28 12v5M12 31h5M39 20l4-4M17 20l-4-4"/><path class="moon" transform="translate(90 0) scale(-1 1)" d="M45 18a10 10 0 1 0 0 20 12 12 0 0 1 0-20z"/>`;
}

export function renderFaviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-hidden="true"><title>Sunrise favicon</title><style>:root{color-scheme:light dark}.sky{fill:#fff4dc}.tray{fill:#fffaf0;stroke:#7b5a34;stroke-width:3}.sun{fill:#ffb23f}.ray{stroke:#c97814;stroke-width:3;stroke-linecap:round}.line{stroke:#7b5a34;stroke-width:3;stroke-linecap:round}.moon{fill:none;stroke:#7b5a34;stroke-width:3;opacity:.28}@media (prefers-color-scheme: dark){.sky{fill:#101824}.tray{fill:#172230;stroke:#dbe8fb}.sun{fill:none;stroke:#dbe8fb;stroke-width:3;opacity:.28}.ray{stroke:#dbe8fb;opacity:.22}.line{stroke:#dbe8fb}.moon{opacity:1;stroke:#dbe8fb;fill:#dbe8fb}}</style>${brandMarkSvgContent()}</svg>`;
}
