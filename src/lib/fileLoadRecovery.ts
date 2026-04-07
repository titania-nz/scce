interface MissingFileRecoveryOptions {
  hasLocalOnlyDraft: boolean;
  selectedFileExists: boolean;
  refreshedFileExists: boolean;
}

// Decide whether a 404 should clear the selected file or be treated as stale/transient.
export function shouldResetSelectedFileAfter404({
  hasLocalOnlyDraft,
  selectedFileExists,
  refreshedFileExists,
}: MissingFileRecoveryOptions): boolean {
  if (hasLocalOnlyDraft) return false;
  if (selectedFileExists) return false;
  if (refreshedFileExists) return false;
  return true;
}
