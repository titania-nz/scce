import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const HOST = '127.0.0.1';
const PORT = 3218;
const BASE_URL = `http://${HOST}:${PORT}`;
const AUTH_PASSWORD = 'test-password';
const AUTH_SECRET = 'test-secret';

let notesDir = '';
let server: ChildProcess | null = null;

test.describe.configure({ timeout: 120_000 });

async function waitForServerReady(baseUrl: string, timeoutMs = 45_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/login`);
      if (response.ok) return;
    } catch {
      // Keep polling until the dev server is ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for Next dev server at ${baseUrl}`);
}

test.beforeAll(async () => {
  notesDir = mkdtempSync(path.join(os.tmpdir(), 'scce-paste-ui-test-'));
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
});

test.afterAll(async () => {
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

test('paste flow creates and opens a new file without a missing-file error', async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  const filename = `claude-paste-${today}.md`;
  const clipboardText = '# Clipboard note\n\nCreated from the browser test.';

  await page.addInitScript((text) => {
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: async () => text,
      },
    });
  }, clipboardText);

  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel('Password').fill(AUTH_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));

  await expect(page.getByRole('button', { name: 'Add' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Paste from clipboard' }).click();

  const newFileInput = page.getByPlaceholder('filename.md');
  await expect(newFileInput).toBeVisible();
  await expect(page.getByText('Clipboard content ready')).toBeVisible();
  await expect(newFileInput).toHaveValue(`paste-${today}`);

  await newFileInput.fill(filename);
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.locator(`text=${filename}`).first()).toBeVisible();
  await expect(page.getByText(`"${filename}" no longer exists.`)).toHaveCount(0);
  await expect(newFileInput).toHaveCount(0);
});
