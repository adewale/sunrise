// Maps each Inertia page name to its concrete prop type so PagePropsFor<'Name'>
// and PageComponent<'Name'> in pages/*.tsx resolve to real shapes instead of
// the generic PageProps fallback.
import type {
  ChangelogProps,
  DashboardProps,
  DesignProps,
  ItemPageProps,
  LandingProps,
  RunsProps,
  SettingsProps,
  SetupPageProps,
} from '../src/app';

declare module '@ts-76/inertia-hono-jsx' {
  interface InertiaPageProps {
    Changelog: ChangelogProps;
    Dashboard: DashboardProps;
    Design: DesignProps;
    Item: ItemPageProps;
    Landing: LandingProps;
    Runs: RunsProps;
    Settings: SettingsProps;
    Setup: SetupPageProps;
  }
}

export {};
