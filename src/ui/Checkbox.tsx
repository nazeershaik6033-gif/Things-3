import { type JSX } from 'solid-js';

/** Things' rounded-square checkbox. Checking fills instantly (CSS only) and
 *  draws the checkmark with a stroke-dashoffset animation. */
export function Checkbox(props: {
  checked: boolean;
  canceled?: boolean;
  size?: number;
  onToggle?: (e: MouseEvent) => void;
}): JSX.Element {
  const size = () => props.size ?? 19;
  return (
    <button
      class="checkbox"
      classList={{ checked: props.checked }}
      onClick={(e) => {
        e.stopPropagation();
        props.onToggle?.(e);
      }}
      style={{
        width: '44px',
        height: '44px',
        margin: '-12px',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        flex: 'none',
      }}
      aria-label={props.checked ? 'Mark incomplete' : 'Mark complete'}
      aria-pressed={props.checked}
    >
      <span
        style={{
          width: `${size()}px`,
          height: `${size()}px`,
          'border-radius': '6px',
          border: props.checked ? 'none' : '1.5px solid var(--check-border)',
          background: props.checked ? 'var(--check-fill)' : 'transparent',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          transition: 'background 120ms ease',
          animation: props.checked ? 'check-pop 240ms ease-out' : 'none',
        }}
      >
        <svg
          viewBox="0 0 14 14"
          width={size() - 6}
          height={size() - 6}
          fill="none"
          stroke="#fff"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"
          style={{ opacity: props.checked ? 1 : 0 }}
        >
          {props.canceled ? (
            <path d="M3 3l8 8M11 3l-8 8" />
          ) : (
            <path
              d="M2.5 7.5l3 3 6-7"
              stroke-dasharray="14"
              stroke-dashoffset={props.checked ? '0' : '14'}
              style={{ transition: 'stroke-dashoffset 200ms ease-out 60ms' }}
            />
          )}
        </svg>
      </span>
    </button>
  );
}
