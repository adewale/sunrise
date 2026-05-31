import { createInertiaApp } from '@ts-76/inertia-hono-jsx';
import { renderToString } from 'hono/jsx/dom/server';
import type { PageObject } from '@hono/inertia';
import type { Page } from '@inertiajs/core';
import Layout from './components/Layout';

const pages = import.meta.glob('./pages/**/*.tsx', { eager: true });

export const renderPage = (page: PageObject) =>
  createInertiaApp({
    page: page as Page,
    render: renderToString,
    layout: () => Layout,
    title: (t) => t ? `${t} | Sunrise` : 'Sunrise',
    resolve: (name) => pages[`./pages/${name}.tsx`] as never,
  });
