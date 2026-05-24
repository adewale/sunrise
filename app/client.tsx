import { createInertiaApp } from '@ts-76/inertia-hono-jsx';
import Layout from './components/Layout';

const pages = import.meta.glob('./pages/**/*.tsx', { eager: true });

createInertiaApp({
  layout: () => Layout,
  resolve: (name) => pages[`./pages/${name}.tsx`] as never,
}).then(() => {
  (window as unknown as { __sunriseHydrated?: boolean }).__sunriseHydrated = true;
});
