export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

const PATHS = {
  points: '<path d="M12 3.2 13.8 9.1 19.8 12 13.8 14.9 12 20.8 10.2 14.9 4.2 12 10.2 9.1Z"/>',
  crown: '<path d="M4 16.2 7.2 7.4 12 12.2 16.8 7.4 20 16.2"/><path d="M5 16.2h14v3.2a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z"/>',
  month: '<circle cx="12" cy="12" r="7"/><path d="M12 5a7 7 0 0 1 0 14"/>',
  year: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.8v3.2M12 18v3.2M2.8 12h3.2M18 12h3.2"/>',
  small: '<circle cx="12" cy="12" r="3"/>',
  medium: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.25"/>',
  big: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.25"/><circle cx="12" cy="12" r="9"/>',
  complete: '<path d="M5 12.5 9.5 17 19 7.5"/>',
  calendar: '<rect x="4" y="5" width="16" height="14.5" rx="2.5"/><path d="M4 9.5h16M8 3.2v3.2M16 3.2v3.2"/>',
  burger: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M7 7l10 10M17 7 7 17"/>',
  sun: '<circle cx="12" cy="12" r="3.4"/><path d="M12 3.1v2.1M12 18.8v2.1M3.1 12h2.1M18.8 12h2.1M5.5 5.5l1.5 1.5M17 17l1.5 1.5M18.5 5.5 17 7M7 17l-1.5 1.5"/>',
  moon: '<path d="M15.4 3.8A7.1 7.1 0 1 0 20.2 16 6.2 6.2 0 0 1 15.4 3.8Z"/>',
  gear: '<path d="M14.7 6.4a3.1 3.1 0 0 0-4.2 4L5 16.1a1.5 1.5 0 0 0 2.1 2.1l5.7-5.6a3.1 3.1 0 0 0 4-4.2l-1.9 1.9-2.2-2.2Z"/>',
  grip: '<circle cx="9" cy="7" r="1.15" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r="1.15" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1.15" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1.15" fill="currentColor" stroke="none"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.2h2"/>',
  bolt: '<path d="M13 2.8 5 13.2h6.2L10.2 21 19 10.2h-6.2L13 2.8z"/>',
  bell: '<path d="M6.2 16.2h11.6L16.6 14V10a4.6 4.6 0 0 0-9.2 0v4z"/><path d="M10 16.2a2 2 0 0 0 4 0"/>',
  list: '<path d="M9 7h10M9 12h10M9 17h10"/><circle cx="5.2" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="5.2" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="5.2" cy="17" r="1" fill="currentColor" stroke="none"/>',
  medal: '<circle cx="12" cy="15" r="5"/><path d="M8.8 10.4 7.2 3.5h3.1L12 7.2l1.7-3.7h3.1l-1.6 6.9"/>',
  gift: '<rect x="4" y="10" width="16" height="10" rx="1.6"/><path d="M4 14.2h16M12 10v10M12 10c-1.8 0-3.6-1-3.6-2.6S10 5 12 8.2C14 5 15.8 6 15.8 7.4S13.8 10 12 10"/>',
  home: '<path d="M4 11.2 12 4.8l8 6.4V20H4z"/><path d="M10 20v-5.5h4V20"/>',
  pin: '<path d="M9 3.5h6l-1 6.2 3 2.1v1.7H7v-1.7l3-2.1z"/><path d="M12 13.5V20.5"/>',
  lock: '<rect x="6" y="10.5" width="12" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shield: '<path d="M12 3.2 19 6.2v5.6c0 4-2.8 6.5-7 7.8-4.2-1.3-7-3.8-7-7.8V6.2z"/>',
};

export function icon(name) {
  const body = PATHS[name] || "";
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export const PALETTE = ["#c56a4a", "#d4a054", "#6f8f78", "#4e7c8a", "#a15d78", "#c4844a", "#7a6a8a", "#3f6f62"];

export function colorClass(color) {
  const index = PALETTE.indexOf(String(color || "").toLowerCase());
  return `c${index < 0 ? 0 : index}`;
}

const FACES = [
  { bg: "#f8e4d8", skin: "#f3c7a8", hair: "#3b2a24", shirt: "#c56a4a", lip: "#c47b6a", style: "short" },
  { bg: "#f8edd4", skin: "#e8b98a", hair: "#6a3e22", shirt: "#d4a054", lip: "#c4846a", style: "bun" },
  { bg: "#e3f0e6", skin: "#f6d3bc", hair: "#2f3b34", shirt: "#6f8f78", lip: "#d08978", style: "wave" },
  { bg: "#dcecf1", skin: "#c68658", hair: "#1e2428", shirt: "#4e7c8a", lip: "#a86b52", style: "crop" },
  { bg: "#f8e4ec", skin: "#f4cbb4", hair: "#4a2c3a", shirt: "#a15d78", lip: "#c46b78", style: "bob" },
  { bg: "#f8eadc", skin: "#d4956a", hair: "#2a2118", shirt: "#c4844a", lip: "#b56a48", style: "curls" },
  { bg: "#eee6f2", skin: "#f6d7c4", hair: "#3a3150", shirt: "#7a6a8a", lip: "#c98998", style: "long" },
  { bg: "#e3f0ea", skin: "#8d552f", hair: "#1c1612", shirt: "#3f6f62", lip: "#6e3e2c", style: "fringe" },
];

function hair(style, color) {
  if (style === "bun") {
    return `<circle cx="32" cy="12" r="6" fill="${color}"/><path d="M18 30c1-12 8-16 14-16s13 4 14 16c-3-6-8-8-14-8s-11 2-14 8z" fill="${color}"/>`;
  }
  if (style === "wave") {
    return `<path d="M16 32c0-14 6-20 16-20 8 0 14 4 16 14-4-8-10-10-16-8-6 1-12 4-16 14z" fill="${color}"/>`;
  }
  if (style === "crop") {
    return `<path d="M20 28c0-9 5-14 12-14s12 5 12 14c-2-5-6-7-12-7s-10 2-12 7z" fill="${color}"/>`;
  }
  if (style === "bob") {
    return `<path d="M15 36c0-16 6-22 17-22s17 6 17 22c-1-2-4 2-7-2-2 8-6 10-10 10s-8-2-10-10c-3 4-6 0-7 2z" fill="${color}"/>`;
  }
  if (style === "curls") {
    return `<circle cx="20" cy="22" r="6" fill="${color}"/><circle cx="32" cy="16" r="7" fill="${color}"/><circle cx="44" cy="22" r="6" fill="${color}"/><path d="M18 30c2-8 8-10 14-10s12 2 14 10c-4-4-8-5-14-5s-10 1-14 5z" fill="${color}"/>`;
  }
  if (style === "long") {
    return `<path d="M18 26c0-12 6-16 14-16s14 4 14 16v16c-2-8-6-10-14-10s-12 2-14 10z" fill="${color}"/>`;
  }
  if (style === "fringe") {
    return `<path d="M18 32c0-14 5-18 14-18s14 4 14 18H18z" fill="${color}"/><rect x="20" y="24" width="24" height="5" rx="2" fill="${color}"/>`;
  }
  return `<path d="M18 30c0-12 5-18 14-18s14 6 14 18c-3-7-8-9-14-9s-11 2-14 9z" fill="${color}"/>`;
}

function portrait(index) {
  const face = FACES[index] || FACES[0];
  return `<svg viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="32" fill="${face.bg}"/>
    <path d="M6 66c10-20 42-20 52 0" fill="${face.shirt}"/>
    <circle cx="32" cy="32" r="14" fill="${face.skin}"/>
    ${hair(face.style, face.hair)}
    <circle cx="27" cy="32" r="1.7" fill="#2a241f"/>
    <circle cx="37.5" cy="32" r="1.7" fill="#2a241f"/>
    <circle cx="27.6" cy="31.4" r="0.55" fill="#fff"/>
    <circle cx="38.1" cy="31.4" r="0.55" fill="#fff"/>
    <circle cx="24" cy="36" r="2" fill="${face.lip}" opacity="0.35"/>
    <circle cx="40" cy="36" r="2" fill="${face.lip}" opacity="0.35"/>
    <path d="M28 37.5c1.3 1.8 6.7 1.8 8 0" fill="none" stroke="${face.lip}" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`;
}

export function avatar(name, color, size) {
  const index = Math.max(0, PALETTE.indexOf(String(color || "").toLowerCase()));
  const large = size === "lg" ? " avatar-lg" : "";
  return `<span class="avatar${large} ${colorClass(color)}" aria-hidden="true">${portrait(index)}</span>`;
}

export function houseMark() {
  return `<span class="empty-mark" aria-hidden="true"><svg viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#d7f3ea"/><path d="M8 32 32 14l24 18v22H8Z" fill="#1f8a70"/><rect x="27" y="38" width="10" height="16" rx="1" fill="#fff7ea"/></svg></span>`;
}
