# Markdown Editor

A personal markdown file editor and viewer built with Next.js.

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Notes are stored in the `notes/` directory by default. Set the `NOTES_DIR` environment variable to use a different path.

## Deploying to Netlify

### 1. Connect the repository

In the Netlify dashboard, create a new site and connect this repository. The `netlify.toml` file configures the build automatically:

- **Build command:** `npm run build`
- **Publish directory:** `.next`
- **Plugin:** `@netlify/plugin-nextjs` (handles Next.js App Router)

### 2. Set environment variables

In **Site Settings → Environment variables**, add the following:

| Variable | Description |
|---|---|
| `AUTH_PASSWORD` | The password you will type on the login screen |
| `AUTH_SECRET` | A long random secret used to sign the auth cookie — generate one with `openssl rand -hex 32` |

### 3. Deploy

Trigger a deploy (or push to your connected branch). Once live, every visit will redirect to a login page. Only someone with the correct `AUTH_PASSWORD` can access the app.

### Notes storage

On Netlify, notes are stored in **Netlify Blobs** (persistent key-value storage included with all Netlify plans). Notes created locally are not synced to Netlify and vice versa.

## Authentication

All routes are protected by a password set via the `AUTH_PASSWORD` environment variable. After a successful login, an httpOnly cookie is set that lasts 30 days. To log out, visit `/login` — a logout option can be added if needed.

If `AUTH_SECRET` is not set, the site will return a `503` error on every request as a safety measure.
