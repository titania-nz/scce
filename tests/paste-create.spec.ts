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

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel('Password').fill(AUTH_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

async function setClipboardText(page: import('@playwright/test').Page, clipboardText: string): Promise<void> {
  await page.evaluate((text) => {
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: async () => text,
      },
    });
  }, clipboardText);
}

async function createFileFromClipboard(page: import('@playwright/test').Page, filename: string, clipboardText: string): Promise<void> {
  await setClipboardText(page, clipboardText);

  const sidebarPane = page.getByTestId('editor-sidebar-pane');
  await sidebarPane.getByPlaceholder('Search file or folder path').fill('');

  const pasteButton = sidebarPane.getByRole('button', { name: 'Paste', exact: true });
  await pasteButton.scrollIntoViewIfNeeded();
  await pasteButton.click();

  const newFileInput = sidebarPane.getByPlaceholder('filename.md');
  await expect(newFileInput).toBeVisible();
  await expect(page.getByText('Clipboard content ready')).toBeVisible();
  await newFileInput.fill(filename);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(newFileInput).toBeHidden();
  const baseName = filename.split('/').at(-1) ?? filename;
  await expect(page.locator('[id^="sidebar-div-001"]').filter({ hasText: baseName }).first()).toBeVisible();
}

async function clickSidebarFile(page: import('@playwright/test').Page, filename: string): Promise<void> {
  await page.locator('[id^="sidebar-div-001"]').filter({ hasText: filename }).first().click();
}

async function getWidth(locator: import('@playwright/test').Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Expected element to have a bounding box');
  }
  return box.width;
}

async function dragHandle(page: import('@playwright/test').Page, locator: import('@playwright/test').Locator, deltaX: number): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Expected resize handle to be visible');
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 8 });
  await page.mouse.up();
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
}, 120_000);

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
  await login(page);
  await createFileFromClipboard(page, filename, clipboardText);

  await expect(page.locator(`text=${filename}`).first()).toBeVisible();
  await expect(page.getByText(`"${filename}" no longer exists.`)).toHaveCount(0);
});

test('workspace pane resizing persists across reloads', async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  const editorFile = `pane-resize-editor-${today}.md`;
  const compareFile = `pane-resize-compare-${today}.md`;

  await login(page);

  await createFileFromClipboard(page, editorFile, '# Pane resize test\n\nEditor workspace.');
  await clickSidebarFile(page, editorFile);

  const sidebarPane = page.getByTestId('editor-sidebar-pane');
  const editorPane = page.getByTestId('editor-pane');
  const previewPane = page.getByTestId('preview-pane');
  const inspectorPane = page.getByTestId('editor-inspector-pane');

  await expect(sidebarPane).toBeVisible();
  await expect(editorPane).toBeVisible();
  await expect(previewPane).toBeVisible();
  await expect(inspectorPane).toBeVisible();

  const initialSidebarWidth = await getWidth(sidebarPane);
  const initialPreviewWidth = await getWidth(previewPane);
  const initialInspectorWidth = await getWidth(inspectorPane);

  await dragHandle(page, page.getByTestId('editor-sidebar-resizer'), 96);
  await dragHandle(page, page.getByTestId('editor-preview-resizer'), -84);
  await dragHandle(page, page.getByTestId('editor-inspector-resizer'), -72);

  const resizedSidebarWidth = await getWidth(sidebarPane);
  const resizedPreviewWidth = await getWidth(previewPane);
  const resizedInspectorWidth = await getWidth(inspectorPane);

  expect(resizedSidebarWidth).toBeGreaterThan(initialSidebarWidth + 8);
  expect(Math.abs(resizedPreviewWidth - initialPreviewWidth)).toBeGreaterThan(4);
  expect(resizedInspectorWidth).toBeGreaterThan(initialInspectorWidth + 8);

  await page.waitForTimeout(250);

  await page.reload();
  await clickSidebarFile(page, editorFile);

  await expect.poll(async () => Math.abs(Math.round(await getWidth(page.getByTestId('editor-sidebar-pane'))) - Math.round(resizedSidebarWidth))).toBeLessThanOrEqual(4);
  await expect.poll(async () => Math.abs(Math.round(await getWidth(page.getByTestId('preview-pane'))) - Math.round(resizedPreviewWidth))).toBeLessThanOrEqual(4);
  await expect.poll(async () => Math.abs(Math.round(await getWidth(page.getByTestId('editor-inspector-pane'))) - Math.round(resizedInspectorWidth))).toBeLessThanOrEqual(4);

  await createFileFromClipboard(page, compareFile, '# Pane resize test\n\nCompare workspace.');
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByTestId('compare-file-a-select')).toBeVisible();

  await page.getByTestId('compare-file-a-select').selectOption(editorFile);
  await page.getByTestId('compare-file-b-select').selectOption(compareFile);
  await page.getByTestId('compare-layout-split').click();

  const compareDiffPane = page.getByTestId('compare-diff-pane');
  const compareOutputPane = page.getByTestId('compare-output-pane');
  const compareResizer = page.getByTestId('compare-resizer');

  await expect(compareResizer).toBeVisible();

  const initialDiffWidth = await getWidth(compareDiffPane);
  const initialOutputWidth = await getWidth(compareOutputPane);

  await dragHandle(page, compareResizer, 92);

  const resizedDiffWidth = await getWidth(compareDiffPane);
  const resizedOutputWidth = await getWidth(compareOutputPane);

  expect(resizedDiffWidth).toBeLessThan(initialDiffWidth);
  expect(resizedOutputWidth).toBeGreaterThan(initialOutputWidth);

  await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), 'scce:compare-split-ratio:v1'))
    .not.toBe('0.5');
  await page.waitForTimeout(250);

  await page.reload();
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByTestId('compare-file-a-select')).toBeVisible();
  await page.getByTestId('compare-file-a-select').selectOption(editorFile);
  await page.getByTestId('compare-file-b-select').selectOption(compareFile);
  await page.getByTestId('compare-layout-split').click();
  await expect(page.getByTestId('compare-resizer')).toBeVisible();
  await expect(page.getByTestId('compare-diff-pane')).toBeVisible();
  await expect(page.getByTestId('compare-output-pane')).toBeVisible();
});

test('desktop tree search keeps folder context and exposes row actions', async ({ page }) => {
  await login(page);

  await createFileFromClipboard(page, 'story/chapter-1/scene-a.md', '# Scene A');
  await createFileFromClipboard(page, 'story/chapter-2/scene-b.md', '# Scene B');

  await page.getByRole('button', { name: 'Collapse story' }).click();

  await page.getByPlaceholder('Search file or folder path').fill('scene-a');
  await expect(page.locator('[id^="sidebar-div-001"]').filter({ hasText: 'scene-a.md' }).first()).toBeVisible();

  await page.getByLabel('Actions for story/chapter-1/scene-a.md').click();
  await expect(page.getByRole('button', { name: 'Rename / move' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();
});

test('mobile sidebar shows find-first controls and opens files from search', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  const createResponse = await page.request.post(`${BASE_URL}/api/files`, {
    data: { name: 'mobile/find-me.md', content: '# Mobile file' },
  });
  expect(createResponse.ok()).toBeTruthy();

  await page.getByRole('button', { name: 'Refresh files' }).click();
  await page.getByLabel('Collapse sidebar').click();
  await page.getByLabel('Expand sidebar').click({ force: true });

  await expect(page.getByPlaceholder('Search file or folder path')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Folder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible();

  await page.getByPlaceholder('Search file or folder path').fill('find-me');
  await page.locator('[id^="sidebar-div-001"]').filter({ hasText: 'find-me.md' }).first().click();
  await expect(page.getByText('mobile/find-me.md').first()).toBeVisible();
});
