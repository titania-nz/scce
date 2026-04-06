import { getStore } from '@netlify/blobs';

export const isNetlifyRuntime =
  process.env.NETLIFY === 'true' ||
  process.env.CONTEXT !== undefined ||
  process.env.NETLIFY_BLOBS_CONTEXT !== undefined;

export function getBlobStore() {
  if (!isNetlifyRuntime) {
    return null;
  }
  return getStore('files');
}
