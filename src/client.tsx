import { createInertiaApp, type ResolvedComponent } from '@inertiajs/react';
import { createRoot } from 'react-dom/client';

const pages = import.meta.glob<{ default: ResolvedComponent }>('../app/pages/**/*.tsx');

createInertiaApp({
  id: 'app',
  resolve: async (name) => {
    const loader = pages[`../app/pages/${name}.tsx`];
    if (!loader) throw new Error(`Unknown Sunrise page: ${name}`);
    return (await loader()).default;
  },
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />);
  },
});
