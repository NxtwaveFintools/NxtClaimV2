"use client";
import { useState, useEffect } from "react";

export function useSessionStorage<T>(key: string, initialValue: T) {
  // Safe initialization that won't break on the Next.js server
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  // Read from storage only after hydration to prevent SSR mismatch errors
  useEffect(() => {
    try {
      const item = window.sessionStorage.getItem(key);
      if (item) {
        // sessionStorage is external state; mount-time synchronization is intentional.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStoredValue(JSON.parse(item));
      }
    } catch (error) {
      console.warn(`Error reading sessionStorage key "${key}":`, error);
    }
  }, [key]);

  // Return a wrapped version of useState's setter function that persists the new value
  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      console.warn(`Error setting sessionStorage key "${key}":`, error);
    }
  };

  return [storedValue, setValue] as const;
}
