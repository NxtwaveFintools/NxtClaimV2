"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

/**
 * SSR-safe `useState` that persists its value to `localStorage`.
 *
 * - Initial render always uses `initialValue` (no `localStorage` read on the
 *   server, so server HTML and first client render match — no hydration mismatch).
 * - A mount effect reads the stored JSON value and restores it on the client.
 * - State changes are debounce-written to `localStorage` (300 ms) to avoid
 *   performance hits during rapid typing.
 */
export function usePersistentState<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(initialValue);

  // Mount: read from localStorage and restore if a value is found.
  // localStorage is an external system — this is the correct React pattern for
  // synchronizing external state into React on mount.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        // localStorage is an external system; reading it on mount is the
        // intended use of effects. The rule fires because setState is called
        // inside an effect body, but this pattern is explicitly recommended by
        // the React docs for external-store synchronization.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState(JSON.parse(stored) as T);
      }
    } catch {
      // Corrupt entry or JSON parse error — leave the initial value in place.
    }
  }, [key]);

  // Write: debounce-persist every state change after the mount read.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {
        // Storage quota exceeded or security restrictions — silently ignore.
      }
    }, 300);

    return () => clearTimeout(id);
  }, [key, state]);

  return [state, setState];
}
