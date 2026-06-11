import { createContext, useContext } from 'solid-js';
import { stack } from './navigation';

/** Each mounted screen knows its stack key; fixed chrome (the Magic Plus FAB)
 *  only renders on the top screen so stacked screens never double up. */
export const ScreenKeyContext = createContext<number>(-1);

export function useIsTopScreen(): () => boolean {
  const key = useContext(ScreenKeyContext);
  return () => {
    const s = stack();
    return s[s.length - 1]?.key === key;
  };
}
