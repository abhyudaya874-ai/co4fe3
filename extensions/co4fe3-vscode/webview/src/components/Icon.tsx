import type { IconName } from "../format.js";

// Small stroke icons on a 16 px grid, drawn for this UI. Inline SVG: nothing to load, so the strict CSP has nothing to allow.
const PATHS: Record<IconName, string> = {
  plus: "M8 3v10M3 8h10",
  slash: "M10.5 2.5l-5 11",
  chevronDown: "M4 6l4 4 4-4",
  chevronRight: "M6 4l4 4-4 4",
  check: "M3.5 8.5l3 3 6-7",
  x: "M4 4l8 8M12 4l-8 8",
  arrowUp: "M8 13V3M4 7l4-4 4 4",
  arrowDown: "M8 3v10M4 9l4 4 4-4",
  stop: "M4.5 4.5h7v7h-7z",
  file: "M4 2h5l3 3v9H4zM9 2v3h3",
  terminal: "M2.5 3.5h11v9h-11zM5 7l2 1.5L5 10M8.5 10.5H11",
  search: "M7 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zM10.5 10.5l3.5 3.5",
  edit: "M3 13l.7-3L11 2.7a1.4 1.4 0 0 1 2 2L5.7 12 3 13zM9.8 4l2.2 2.2",
  sparkle: "M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4zM12.5 11.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z",
  shield: "M8 2l5 1.8v4.2c0 3-2.2 5-5 6-2.8-1-5-3-5-6V3.8z",
  clock: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8 4.5V8l2.5 1.5",
  expand: "M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9",
  collapse: "M13 6.5H9.5V3M3 9.5h3.5V13M9.5 6.5l4-4M6.5 9.5l-4 4",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4",
  alert: "M8 2.5l6 10.5H2zM8 6.5v3M8 11.2v.1",
  link: "M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.7.7M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.7-.7",
  folder: "M2 4.5h4l1.5 1.5H14v7H2z",
  brain: "M6 12h4M6.5 14h3M8 2a4 4 0 0 0-2.3 7.2c.4.3.6.7.6 1.2V11h3.4v-.6c0-.5.2-.9.6-1.2A4 4 0 0 0 8 2z",
  tool: "M10.5 2.5a3.5 3.5 0 0 0-3.2 4.8L2.5 12.1a1.4 1.4 0 0 0 2 2l4.8-4.8a3.5 3.5 0 0 0 4.8-3.2l-2.2 2.2-2-.5-.5-2z",
  users: "M6 7a2.2 2.2 0 1 0 0-4.4A2.2 2.2 0 0 0 6 7zM2 13c0-2.2 1.8-3.8 4-3.8s4 1.6 4 3.8M11 6.5a2 2 0 1 0 0-4M12 9.5c1.3.4 2 1.6 2 3",
  undo: "M3 6h6a3.5 3.5 0 0 1 0 7H6M3 6l2.5-2.5M3 6l2.5 2.5",
  layers: "M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3",
  book: "M3 3h4.5A1.5 1.5 0 0 1 9 4.5V13a1.5 1.5 0 0 0-1.5-1.5H3zM13 3H8.5A1.5 1.5 0 0 0 7 4.5V13a1.5 1.5 0 0 1 1.5-1.5H13z",
  bolt: "M9 2L3.5 9H8l-1 5 5.5-7H8z",
};
const FILLED: ReadonlySet<IconName> = new Set<IconName>(["stop"]);

export function Icon({ name, size = 14, className }: { name: IconName; size?: number; className?: string }) {
  const filled = FILLED.has(name);
  return (
    <svg className={`icon${className ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false"
      fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={filled ? 0 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The co4fe3 mark: a ring with a notch. */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M5.4 8a2.6 2.6 0 1 1 2.6 2.6" />
    </svg>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
