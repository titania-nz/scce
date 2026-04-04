'use client';

import { useEffect, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';

interface UseAutoSaveOptions {
  content: string;
  filename: string | null;
  isDirty: boolean;
  saveFn: (content: string) => Promise<void>;
  debounceMs?: number;
}

export function useAutoSave({
  content,
  filename,
  isDirty,
  saveFn,
  debounceMs = 1500,
}: UseAutoSaveOptions) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [debouncedContent] = useDebounce(content, debounceMs);
  const isDirtyRef = useRef(isDirty);
  const saveFnRef = useRef(saveFn);

  isDirtyRef.current = isDirty;
  saveFnRef.current = saveFn;

  // Debounced auto-save
  useEffect(() => {
    if (!filename || !isDirtyRef.current) return;
    let cancelled = false;
    setIsSaving(true);
    setSaveError(null);
    saveFnRef.current(debouncedContent)
      .then(() => {
        if (!cancelled) setIsSaving(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setIsSaving(false);
          setSaveError(err.message ?? 'Save failed');
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedContent, filename]);

  async function saveNow(currentContent: string): Promise<void> {
    if (!filename) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveFnRef.current(currentContent);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setSaveError(e.message ?? 'Save failed');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }

  return { isSaving, saveError, saveNow };
}
