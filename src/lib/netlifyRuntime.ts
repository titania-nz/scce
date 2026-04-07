import { getStore } from '@netlify/blobs';

// Detect whether the app is running inside Netlify rather than plain local filesystem mode.
export const isNetlifyRuntime =
  process.env.NETLIFY === 'true' ||
  process.env.CONTEXT !== undefined ||
  process.env.NETLIFY_BLOBS_CONTEXT !== undefined;

// Return the shared Netlify Blob store when that runtime is available.
export function getBlobStore() {
  if (!isNetlifyRuntime) {
    return null;
  }
  return getStore('files');
}
