interface ErrorPayload {
  error?: unknown;
}

// Public hook/helper: called from UI code to encapsulate shared stateful behavior.
export async function fetchJson<T>(url: string, fallbackMessage: string): Promise<T> {
  const response = await fetch(url);
  const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
  if (!response.ok) {
    const message =
      typeof payload.error === 'string' && payload.error.length > 0
        ? payload.error
        : fallbackMessage;
    throw new Error(message);
  }
  return payload as T;
}
