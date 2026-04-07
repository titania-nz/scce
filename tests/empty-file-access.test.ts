import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { isMissingBlobValue } from '../src/lib/blobValue.ts';

const HOST = '127.0.0.1';
const PORT = 3217;
const BASE_URL = `http://${HOST}:${PORT}`;
const AUTH_PASSWORD = 'test-password';
const AUTH_SECRET = 'test-secret';

let notesDir = '';
let server: ChildProcess | null = null;
let authCookie = '';

async function waitForServerReady(baseUrl: string, timeoutMs = 45_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/login`);
      if (response.ok) return;
    } catch {
      // Keep polling until the dev server is ready to accept requests.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for Next dev server at ${baseUrl}`);
}

before(async () => {
  notesDir = mkdtempSync(path.join(os.tmpdir(), 'scce-empty-file-test-'));
  server = spawn(
    'bash',
    [
      '-lc',
      `AUTH_PASSWORD='${AUTH_PASSWORD}' AUTH_SECRET='${AUTH_SECRET}' NOTES_DIR='${notesDir}' ./node_modules/.bin/next dev --hostname ${HOST} --port ${PORT}`,
    ],
    {
      cwd: '/workspaces/scce',
      env: process.env,
      detached: true,
      stdio: 'pipe',
    },
  );

  server.stdout?.on('data', () => {});
  server.stderr?.on('data', () => {});

  await waitForServerReady(BASE_URL);

  const loginResponse = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: AUTH_PASSWORD }),
  });
  assert.equal(loginResponse.status, 200);

  const setCookie = loginResponse.headers.get('set-cookie');
  assert.ok(setCookie, 'expected login response to return an auth cookie');
  authCookie = setCookie.split(';', 1)[0] ?? '';
  assert.ok(authCookie, 'expected login response to include a cookie pair');
});

after(async () => {
  if (server?.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // Ignore already-exited servers.
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));

    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      // Ignore already-exited servers.
    }
  }

  if (notesDir) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

test('blob missing helper preserves empty payloads', () => {
  assert.equal(isMissingBlobValue(null), true);
  assert.equal(isMissingBlobValue(undefined), true);
  assert.equal(isMissingBlobValue(''), false);
  assert.equal(isMissingBlobValue(new Uint8Array()), false);
});

test('empty files can be created, listed, opened, and renamed through the file routes', async () => {
  const originalName = 'empty-sidebar-route.md';
  const renamedName = 'empty-sidebar-route-v2.md';

  const createResponse = await fetch(`${BASE_URL}/api/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ name: originalName, content: '' }),
  });
  assert.equal(createResponse.status, 201);

  const duplicateCreateResponse = await fetch(`${BASE_URL}/api/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ name: originalName, content: '' }),
  });
  assert.equal(duplicateCreateResponse.status, 409);

  const listResponse = await fetch(`${BASE_URL}/api/files`, {
    headers: { Cookie: authCookie },
  });
  assert.equal(listResponse.status, 200);
  const listPayload = (await listResponse.json()) as { files?: Array<{ name: string }> };
  assert.equal(listPayload.files?.some((file) => file.name === originalName), true);

  const openResponse = await fetch(`${BASE_URL}/api/files/${encodeURIComponent(originalName)}`, {
    headers: { Cookie: authCookie },
  });
  assert.equal(openResponse.status, 200);
  const openPayload = (await openResponse.json()) as { content?: string; name?: string };
  assert.equal(openPayload.name, originalName);
  assert.equal(openPayload.content, '');

  const renameResponse = await fetch(`${BASE_URL}/api/files/${encodeURIComponent(originalName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ newName: renamedName }),
  });
  assert.equal(renameResponse.status, 200);

  const renamedOpenResponse = await fetch(`${BASE_URL}/api/files/${encodeURIComponent(renamedName)}`, {
    headers: { Cookie: authCookie },
  });
  assert.equal(renamedOpenResponse.status, 200);
  const renamedOpenPayload = (await renamedOpenResponse.json()) as { content?: string; name?: string };
  assert.equal(renamedOpenPayload.name, renamedName);
  assert.equal(renamedOpenPayload.content, '');
});

test('new paste-style files open immediately after creation', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const name = `claude-paste-${today}.md`;

  const createResponse = await fetch(`${BASE_URL}/api/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ name, content: '' }),
  });
  assert.equal(createResponse.status, 201);

  const createPayload = (await createResponse.json()) as { name?: string };
  assert.equal(createPayload.name, name);

  const openResponse = await fetch(`${BASE_URL}/api/files/${encodeURIComponent(name)}`, {
    headers: { Cookie: authCookie },
  });
  assert.equal(openResponse.status, 200);

  const openPayload = (await openResponse.json()) as { name?: string; content?: string };
  assert.equal(openPayload.name, name);
  assert.equal(openPayload.content, '');
});
