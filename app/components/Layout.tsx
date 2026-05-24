import type { Child } from 'hono/jsx';
import { usePage, Link } from '@ts-76/inertia-hono-jsx';
import { DashboardHeader, SettingsHeader } from '../pages/_shared';

export function BrandMark() {
  return (
    <svg class="brand-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true">
      <rect class="sky" width="64" height="64" rx="16" />
      <path class="tray" d="M12 38h40l-4 12H16z" />
      <path class="line" d="M20 44h24" />
      <circle class="sun" cx="28" cy="31" r="11" />
      <path class="ray" d="M28 12v5M12 31h5M39 20l4-4M17 20l-4-4" />
      <path class="moon" transform="translate(90 0) scale(-1 1)" d="M45 18a10 10 0 1 0 0 20 12 12 0 0 1 0-20z" />
    </svg>
  );
}

export function ThemeToggle() {
  return (
    <button class="theme-toggle" type="button" aria-label="Toggle dark mode" aria-pressed="false" title="Toggle dark mode">
      <span class="sun-icon" aria-hidden="true"></span>
      <span class="moon-icon" aria-hidden="true"></span>
    </button>
  );
}

function HeaderExtra() {
  const page = usePage();
  const props = page.props as any;
  if (page.component === 'Dashboard') return <DashboardHeader {...props} />;
  if (page.component === 'Settings' || page.component === 'Changelog') return <SettingsHeader {...props} />;
  return null;
}

export default function Layout({ children }: { children?: Child }) {
  return (
    <>
      <a class="skip-link" href="#content">Skip to content</a>
      <header class="site-header">
        <Link class="brand" href="/"><BrandMark /><span>Sunrise</span></Link>
        <HeaderExtra />
        <ThemeToggle />
      </header>
      <main id="content">{children}</main>
    </>
  );
}
