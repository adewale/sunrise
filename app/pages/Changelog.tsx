import { Head, Link, type PageComponent } from '@ts-76/inertia-hono-jsx';

const Changelog: PageComponent<'Changelog'> = (props) => {
  return <><Head title="Changelog" /><section class="section panel"><div class="section-head"><div><p class="eyebrow">What changed</p><h1>Changelog</h1><p class="muted">Privacy-preserving release notes for you and your coding agent. Sunrise does not register this deployment upstream.</p></div><Link class="button ghost" href="/settings">Settings</Link></div><div class="config-card"><p><span>Current version</span><code>{props.version.version}</code></p><p><span>Upgrade contract</span><code>{props.version.upgradeContract}</code></p></div><pre class="changelog-text">{props.changelog}</pre></section></>;
};

export default Changelog;
