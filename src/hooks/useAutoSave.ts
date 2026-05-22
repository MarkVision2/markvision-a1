import { useEffect, useRef, useState } from "react";

export type AutoSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

interface Options<T> {
  /** Current value to track. When it changes (and isn't equal to the last saved snapshot) → triggers save. */
  value: T;
  /** Async function performing the actual save. Throw to mark as error. */
  onSave: (value: T) => Promise<void>;
  /** Debounce in ms before save fires. Default 800ms. */
  delay?: number;
  /** Skip saving when this returns false. */
  enabled?: boolean;
  /** Compare two values for equality. Default — JSON.stringify. */
  isEqual?: (a: T, b: T) => boolean;
}

/**
 * Debounced auto-save: watches `value`, saves it via `onSave` after the user stops editing.
 * Skips the very first render (so it doesn't save initially-loaded data).
 */
export function useAutoSave<T>({ value, onSave, delay = 800, enabled = true, isEqual }: Options<T>) {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const lastSavedRef = useRef<T>(value);
  const firstRunRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  const eq = isEqual ?? ((a: T, b: T) => JSON.stringify(a) === JSON.stringify(b));

  // Keep latest onSave callback without retriggering the debounce effect on every parent render.
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  useEffect(() => {
    if (!enabled) return;
    // Don't save on first render — let parent load data first.
    if (firstRunRef.current) {
      firstRunRef.current = false;
      lastSavedRef.current = value;
      return;
    }
    if (eq(value, lastSavedRef.current)) return;

    setStatus("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      try {
        await onSaveRef.current(value);
        lastSavedRef.current = value;
        setError(null);
        setStatus("saved");
        // Auto-fade to idle after a moment
        setTimeout(() => {
          setStatus((s) => (s === "saved" ? "idle" : s));
        }, 1500);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка сохранения");
        setStatus("error");
      }
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled]);

  /** Reset baseline (e.g. after external data reload from realtime). */
  const markSaved = (v: T) => {
    lastSavedRef.current = v;
    setStatus("idle");
  };

  return { status, error, markSaved };
}