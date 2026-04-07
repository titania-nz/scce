# SCCE Markdown Workspace

This project is a password-protected markdown writing workspace built with Next.js.

It is designed for drafting, revising, reviewing, and publishing markdown files without needing a separate database. When you run it locally, the app stores notes on disk in the `notes/` folder. When you deploy it to Netlify, it stores the same kinds of records in Netlify Blobs instead.

## What the app does

- Create, rename, delete, and edit markdown files
- Save revision checkpoints with notes, tags, and statuses
- Compare revisions to see what changed
- Keep local draft copies and recover unsaved work
- Group document revisions into a review dashboard
- Add revision comments and collaboration metadata
- Publish accepted revisions through a simple publish flow
- Export content from the editor

## How the project is organized

- `src/app/`: Next.js routes, pages, and API endpoints
- `src/components/`: the visible editor interface
- `src/hooks/`: reusable React logic for loading and saving data
- `src/lib/`: storage, authentication, export, and helper utilities
- `src/types/`: shared TypeScript data shapes
- `notes/`: local markdown files when running on your machine

## Local setup

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

By default, files are stored in `notes/`. If you want to use a different folder, set `NOTES_DIR` before starting the app.

Example:

```bash
NOTES_DIR=/absolute/path/to/my-notes npm run dev
```

## Required environment variables

The app expects these values when authentication is enabled:

| Variable | What it is for |
|---|---|
| `AUTH_PASSWORD` | The password entered on the login screen |
| `AUTH_SECRET` | A long secret used to sign the login cookie |

You can generate a secret with:

```bash
openssl rand -hex 32
```

If `AUTH_SECRET` is missing, the app intentionally refuses requests with a `503` response so it is not accidentally exposed with insecure auth.

## How storage works

### Local development

- Markdown files live in `notes/`
- Revision history is stored alongside them in hidden support folders
- Publish history and document review records are stored locally too

### Netlify deployment

- Notes and metadata are stored in Netlify Blobs
- Local files are not automatically synced to Netlify
- Netlify-hosted files are also not automatically copied back to your local machine

## Main workflows

### Writing

Open a file in the editor, type as usual, and the app keeps a working draft while you edit. A checkpoint save creates a revision entry with optional note, tags, and status values.

### Reviewing

Revisions can be compared, promoted through branch states such as draft or accepted, and discussed through revision comments and collaboration metadata.

### Publishing

Publishing is intentionally lightweight in this codebase. An accepted revision can be published through one of the configured publish profiles, and the app records a publish history so previous published content can be restored.

## Deploying to Netlify

The repository already includes a `netlify.toml` file, so the main setup steps are:

1. Create a new Netlify site and connect this repository.
2. Confirm the build command is `npm run build`.
3. Confirm the publish directory is `.next`.
4. Add `AUTH_PASSWORD` and `AUTH_SECRET` in the Netlify environment settings.
5. Deploy the site.

The Next.js build is handled through `@netlify/plugin-nextjs`.

## Notes for non-developers reading the code

This repo now includes more inline comments around the shared hooks and storage helpers. The comments are written to explain what each function is responsible for in plain language, especially in the files that handle saving, loading, revisions, authentication, and publishing.
