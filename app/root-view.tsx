import { raw } from 'hono/html';
import { ViteClient, Script, Link } from 'vite-ssr-components/hono';
import type { RootView } from '@hono/inertia';
import { renderPage } from './ssr';
import { themeScript } from './theme';
import { ThemeToggle, BrandMark } from './components/Layout';

const FONTS =
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,600..900,60,1&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap';

function DocumentHead({ boot, extraHead }: { boot: boolean; extraHead?: string[] }) {
  return (
    <head>
      <meta charset="utf-8" />
      {boot ? null : <title>Sunrise</title>}
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      <link href={FONTS} rel="stylesheet" />
      <script>{raw(themeScript)}</script>
      <ViteClient />
      {boot ? <Script src="/app/client.tsx" /> : null}
      <Link href="/app/styles.css" rel="stylesheet" />
      {(extraHead ?? []).map((h) => raw(h))}
    </head>
  );
}

export const rootView: RootView = async (page) => {
  const { head, body } = await renderPage(page);
  const doc = (
    <html lang="en">
      <DocumentHead boot extraHead={head} />
      <body>{raw(body)}</body>
    </html>
  );
  return '<!DOCTYPE html>' + (await doc.toString());
};

// Standalone document for non-Inertia terminal pages (OAuth errors, etc.).
// Skips the Inertia client boot because there is no #app mount to hydrate.
export async function renderErrorDocument(bodyHtml: string) {
  const doc = (
    <html lang="en">
      <DocumentHead boot={false} />
      <body>
        <a class="skip-link" href="#content">Skip to content</a>
        <header class="site-header">
          <a class="brand" href="/"><BrandMark /><span>Sunrise</span></a>
          <ThemeToggle />
        </header>
        <main id="content">{raw(bodyHtml)}</main>
      </body>
    </html>
  );
  return '<!DOCTYPE html>' + (await doc.toString());
}
