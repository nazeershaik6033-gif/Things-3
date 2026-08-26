import { createEffect, onMount, type JSX } from 'solid-js';

/** Focus-safe text inputs.
 *
 *  Binding `value={signal()}` on a focused field is a trap on iOS: every echo
 *  from the debounced DB write reassigns `.value`, which collapses the caret to
 *  the end of the field and — inside a sheet that is simultaneously reflowing —
 *  can drop the software keyboard entirely. These components keep the DOM node
 *  authoritative while it has focus and only sync from props when it does not,
 *  so a round-trip through Dexie can never interrupt typing. */

function syncValue(el: HTMLInputElement | HTMLTextAreaElement, next: string): boolean {
  if (document.activeElement === el) return false;
  if (el.value === next) return false;
  el.value = next;
  return true;
}

export function autosize(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function AutoTextarea(props: {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  rows?: number;
  /** Fill the available height (flex child) instead of growing with content. */
  fill?: boolean;
  enterkeyhint?: 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';
  autofocus?: boolean;
  onKeyDown?: (e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  ref?: (el: HTMLTextAreaElement) => void;
  style?: JSX.CSSProperties;
  class?: string;
}): JSX.Element {
  let el!: HTMLTextAreaElement;

  onMount(() => {
    el.value = props.value;
    if (!props.fill) autosize(el);
    props.ref?.(el);
    if (props.autofocus) el.focus();
  });

  createEffect(() => {
    const next = props.value;
    if (el && syncValue(el, next) && !props.fill) autosize(el);
  });

  return (
    <textarea
      ref={el}
      class={props.class}
      placeholder={props.placeholder}
      rows={props.rows ?? 1}
      enterkeyhint={props.enterkeyhint}
      onInput={(e) => {
        if (!props.fill) autosize(e.currentTarget);
        props.onInput(e.currentTarget.value);
      }}
      onKeyDown={(e) => props.onKeyDown?.(e)}
      onBlur={() => props.onBlur?.()}
      onFocus={() => props.onFocus?.()}
      style={{
        width: '100%',
        overflow: props.fill ? 'auto' : 'hidden',
        ...(props.fill ? { flex: '1', 'min-height': '0' } : {}),
        ...props.style,
      }}
    />
  );
}

export function SyncedInput(props: {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  onKeyDown?: (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => void;
  onBlur?: () => void;
  ref?: (el: HTMLInputElement) => void;
  style?: JSX.CSSProperties;
  attrs?: Record<string, string>;
}): JSX.Element {
  let el!: HTMLInputElement;

  onMount(() => {
    el.value = props.value;
    props.ref?.(el);
  });

  createEffect(() => {
    const next = props.value;
    if (el) syncValue(el, next);
  });

  return (
    <input
      ref={el}
      {...(props.attrs ?? {})}
      placeholder={props.placeholder}
      onInput={(e) => props.onInput(e.currentTarget.value)}
      onKeyDown={(e) => props.onKeyDown?.(e)}
      onBlur={() => props.onBlur?.()}
      style={props.style}
    />
  );
}
