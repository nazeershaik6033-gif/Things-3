import { type JSX, Show } from 'solid-js';

/** Hand-drawn icon set (original artwork, no third-party assets). All glyphs
 *  inherit currentColor so themes tint them for free. */

export type IconName =
  | 'inbox' | 'star' | 'calendar' | 'layers' | 'archive' | 'logbook' | 'trash'
  | 'hexagon' | 'pie' | 'search' | 'settings' | 'plus' | 'moon' | 'flag'
  | 'chevron-left' | 'chevron-right' | 'ellipsis' | 'tag' | 'checklist'
  | 'notes' | 'arrow-move' | 'close' | 'check' | 'restore' | 'heading'
  | 'export' | 'import' | 'link' | 'bell' | 'sunrise' | 'sun' | 'pencil';

/** Factories, not elements: Solid JSX creates real DOM nodes, so a shared
 *  element would be MOVED between icons instead of rendered in each. */
const PATHS: Record<IconName, () => JSX.Element> = {
  inbox: () => (
    <>
      <path d="M4.5 5.5h15a1 1 0 0 1 .96.72l2 7.28v5a2 2 0 0 1-2 2h-17a2 2 0 0 1-2-2v-5l2.04-7.28a1 1 0 0 1 1-.72Z" fill="currentColor" opacity="0.25" stroke="none" />
      <path d="M2.5 13.5 4.54 6.22a1 1 0 0 1 .96-.72h13a1 1 0 0 1 .96.72l2.04 7.28v5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-5Z" />
      <path d="M2.5 13.5h5.1a1 1 0 0 1 1 .88 3.4 3.4 0 0 0 6.8 0 1 1 0 0 1 1-.88h5.1" />
    </>
  ),
  star: () => (
    <path
      d="M12 2.8 14.7 8.6l6.3.8-4.6 4.3 1.2 6.2L12 16.9 6.4 19.9l1.2-6.2L3 9.4l6.3-.8L12 2.8Z"
      fill="currentColor"
      stroke="currentColor"
      stroke-linejoin="round"
    />
  ),
  bell: () => (
    <>
      <path d="M12 3a6 6 0 0 0-6 6v3.2c0 .9-.4 1.8-1 2.5l-1 1.1h16l-1-1.1c-.6-.7-1-1.6-1-2.5V9a6 6 0 0 0-6-6z" stroke-linejoin="round" />
      <path d="M9.5 18.8a2.6 2.6 0 0 0 5 0" stroke-linecap="round" />
    </>
  ),
  calendar: () => (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" fill="currentColor" opacity="0.22" stroke="none" />
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18" />
      <path d="M8 2.8v3.4M16 2.8v3.4" stroke-linecap="round" />
    </>
  ),
  layers: () => (
    <>
      <path d="m12 3.2 9 4.6-9 4.6-9-4.6 9-4.6Z" fill="currentColor" opacity="0.25" stroke="none" />
      <path d="m12 3.2 9 4.6-9 4.6-9-4.6 9-4.6Z" stroke-linejoin="round" />
      <path d="m4.4 11.5 7.6 3.9 7.6-3.9M4.4 15.6l7.6 3.9 7.6-3.9" stroke-linejoin="round" />
    </>
  ),
  archive: () => (
    <>
      <rect x="2.8" y="4" width="18.4" height="5" rx="1.4" fill="currentColor" opacity="0.25" stroke="none" />
      <rect x="2.8" y="4" width="18.4" height="5" rx="1.4" />
      <path d="M4.6 9v9a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2V9" />
      <path d="M9.5 12.8h5" stroke-linecap="round" />
    </>
  ),
  logbook: () => (
    <>
      <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17.5H7.5A2.5 2.5 0 0 0 5 22V4.5Z" fill="currentColor" opacity="0.22" stroke="none" />
      <path d="M5 19.5V4.5A2.5 2.5 0 0 1 7.5 2H19v17.5M5 19.5A2.5 2.5 0 0 1 7.5 17H19M5 19.5A2.5 2.5 0 0 0 7.5 22H19" />
      <path d="m9.2 9 2.2 2.2 4-4.4" stroke-linecap="round" stroke-linejoin="round" />
    </>
  ),
  trash: () => (
    <>
      <path d="M4 6.5h16M9.5 4h5M6 6.5l.9 13a2 2 0 0 0 2 1.9h6.2a2 2 0 0 0 2-1.9l.9-13" stroke-linecap="round" />
      <path d="M9.8 10.5v7M14.2 10.5v7" stroke-linecap="round" />
    </>
  ),
  hexagon: () => (
    <path d="M12 2.9 19.8 7.4v9.2L12 21.1 4.2 16.6V7.4L12 2.9Z" stroke-width="1.4" stroke-linejoin="round" />
  ),
  pie: () => <circle cx="12" cy="12" r="8.5" stroke-width="1.6" />,
  search: () => (
    <>
      <circle cx="10.5" cy="10.5" r="6.7" />
      <path d="m15.5 15.5 5.2 5.2" stroke-linecap="round" />
    </>
  ),
  settings: () => (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" stroke-linecap="round" />
    </>
  ),
  plus: () => <path d="M12 5v14M5 12h14" stroke-width="2.4" stroke-linecap="round" />,
  moon: () => (
    <path
      d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"
      fill="currentColor"
      stroke="currentColor"
      stroke-linejoin="round"
    />
  ),
  flag: () => (
    <path d="M5.5 21V4.2c0-.4.3-.8.7-.9C7.5 3 9 2.8 10.5 3.4c2.2.9 4 1 6.9.2.5-.2 1.1.2 1.1.8v8.3c0 .4-.3.8-.7.9-2.6.7-4.6.5-6.6-.3-1.7-.7-3.5-.4-5.7.3" fill="currentColor" opacity="0.25" stroke-linecap="round" />
  ),
  'chevron-left': () => <path d="M15 4.5 7.5 12l7.5 7.5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />,
  'chevron-right': () => <path d="m9 4.5 7.5 7.5L9 19.5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />,
  ellipsis: () => (
    <>
      <circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
  tag: () => (
    <>
      <path d="m12.7 3.5 7.4 7.4a2 2 0 0 1 0 2.8l-6.4 6.4a2 2 0 0 1-2.8 0l-7.4-7.4a1.5 1.5 0 0 1-.44-1.06V5a1.5 1.5 0 0 1 1.5-1.5h6.58c.4 0 .78.16 1.06.44Z" />
      <circle cx="7.6" cy="7.6" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  checklist: () => (
    <>
      <path d="m3.5 6 1.6 1.6L8 4.7M3.5 13l1.6 1.6L8 11.7M3.5 20l1.6 1.6L8 18.7" stroke-linecap="round" stroke-linejoin="round" transform="translate(0,-1.6)" />
      <path d="M11 5.5h9.5M11 12.5h9.5M11 19.5h9.5" stroke-linecap="round" transform="translate(0,-1.6)" />
    </>
  ),
  notes: () => <path d="M4.5 6h15M4.5 11h15M4.5 16h9" stroke-linecap="round" />,
  'arrow-move': () => (
    <path d="M5 12h13M13.5 6.5 19 12l-5.5 5.5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  ),
  close: () => <path d="m6 6 12 12M18 6 6 18" stroke-width="2.2" stroke-linecap="round" />,
  check: () => <path d="m4.5 12.5 5 5L19.5 7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />,
  restore: () => (
    <>
      <path d="M4 8.5A9 9 0 1 1 3.5 14" stroke-linecap="round" />
      <path d="M4 3.5v5h5" stroke-linecap="round" stroke-linejoin="round" />
    </>
  ),
  heading: () => <path d="M5 5.5v13M19 5.5v13M5 12h14" stroke-width="2.1" stroke-linecap="round" />,
  export: () => (
    <>
      <path d="M12 3.5v11M7.5 8 12 3.5 16.5 8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M4.5 13.5v5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" stroke-linecap="round" />
    </>
  ),
  import: () => (
    <>
      <path d="M12 14.5v-11M7.5 10l4.5 4.5L16.5 10" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M4.5 13.5v5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" stroke-linecap="round" />
    </>
  ),
  link: () => (
    <path d="M10 14.5 14 10.5M8.5 12 6 14.5a3.5 3.5 0 0 0 5 5l2.5-2.5M15.5 12 18 9.5a3.5 3.5 0 0 0-5-5l-2.5 2.5" stroke-linecap="round" />
  ),
  sunrise: () => (
    <>
      <path d="M5 15.5a7 7 0 0 1 14 0" stroke-linecap="round" />
      <path d="M2.5 15.5h19" stroke-linecap="round" />
      <path d="M12 3v2.5M18.5 6.5l-1.7 1.7M21 12.5h-2.5M5.5 6.5l1.7 1.7M3 12.5h2.5" stroke-linecap="round" />
    </>
  ),
  sun: () => (
    <>
      <circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.25" stroke="none" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" stroke-linecap="round" />
    </>
  ),
  pencil: () => (
    <path d="M14.5 4 20 9.5 8 21.5l-5.5.5.5-5.5L14.5 4ZM17.5 6.5l-12 12" stroke-linecap="round" stroke-linejoin="round" />
  ),
};

export function Icon(props: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: JSX.CSSProperties;
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.size ?? 22}
      height={props.size ?? 22}
      fill="none"
      stroke="currentColor"
      stroke-width={props.strokeWidth ?? 1.8}
      style={{ color: props.color, flex: 'none', ...props.style }}
      aria-hidden="true"
    >
      {PATHS[props.name]()}
    </svg>
  );
}

/** Colored list icon used in the sidebar and pickers. */
export function ListIcon(props: { list: string; size?: number }): JSX.Element {
  const map: Record<string, { name: IconName; color: string }> = {
    inbox: { name: 'inbox', color: 'var(--blue)' },
    today: { name: 'star', color: 'var(--yellow)' },
    upcoming: { name: 'calendar', color: 'var(--red)' },
    anytime: { name: 'layers', color: 'var(--teal)' },
    someday: { name: 'archive', color: 'var(--tan)' },
    logbook: { name: 'logbook', color: 'var(--green)' },
    trash: { name: 'trash', color: 'var(--text-secondary)' },
  };
  const entry = () => map[props.list];
  return (
    <Show when={entry()}>
      <Icon name={entry()!.name} color={entry()!.color} size={props.size ?? 23} />
    </Show>
  );
}
