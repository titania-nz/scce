'use client';

import { useEffect, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';

interface UseAutoSaveOptions {
  content: string;
  filename: string | null;
  isDirty: boolean;
  saveWorkingCopyFn: (content: string) => Promise<void>;
  /**
   * @deprecated Use saveCheckpointFn instead.
   */
  saveFn?: (content: string) => Promise<void>;
  saveCheckpointFn?: (content: string) => Promise<void>;
  debounceMs?: number;
}

export function useAutoSave({
  content,
  filename,
  isDirty,
  saveWorkingCopyFn,
  saveFn,
  saveCheckpointFn,
  debounceMs = 1500,
}: UseAutoSaveOptions) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [debouncedContent] = useDebounce(content, debounceMs);
  const isDirtyRef = useRef(isDirty);
  const saveWorkingCopyFnRef = useRef(saveWorkingCopyFn);
  const saveCheckpointFnRef = useRef(saveFn ?? saveCheckpointFn);

  isDirtyRef.current = isDirty;
  saveWorkingCopyFnRef.current = saveWorkingCopyFn;
  saveCheckpointFnRef.current = saveFn ?? saveCheckpointFn;

  // Debounced auto-save to working copy buffer.
  useEffect(() => {
    if (!filename || !isDirtyRef.current) return;
    let cancelled = false;
    setIsSaving(true);
    setSaveError(null);
    saveWorkingCopyFnRef.current(debouncedContent)
      .then(() => {
        if (!cancelled) setIsSaving(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setIsSaving(false);
          setSaveError(err.message ?? 'Auto-save failed');
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
      const checkpointSave = saveCheckpointFnRef.current;
      if (!checkpointSave) {
        throw new Error('No checkpoint save callback provided');
      }
      await checkpointSave(currentContent);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setSaveError(e.message ?? 'Checkpoint save failed');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }

  return { isSaving, saveError, saveNow };
}
