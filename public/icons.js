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
  grip: '<circle cx="9" cy="7" r="1.15" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r="1.15" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1.15" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1.15" fill="currentColor" stroke="none"/>',
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

export function avatar(name, color) {
  const letter = esc(String(name || "?").trim().slice(0, 1).toUpperCase() || "?");
  return `<span class="avatar ${colorClass(color)}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1.25" y="1.25" width="21.5" height="21.5" rx="7" fill="currentColor"/></svg><span class="avatar-letter">${letter}</span></span>`;
}
