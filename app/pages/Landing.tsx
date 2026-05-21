import { SetupGuide } from './_shared';

export default function Landing(props: any) {
  const repoUrl = String(props.repoUrl ?? 'https://github.com/adewale/sunrise').replace(/\/$/, '');
  return <><section class="hero panel"><p class="actions"><a class="button primary" href={repoUrl}>Deploy your own</a>{props.projectLanding ? null : <> <a class="button ghost" href="/login">Sign in with GitHub</a></>}</p><p class="muted">Single-user, read-only by default, and your snapshots stay in your Cloudflare account.</p><figure class="product-shot"><img src={`${repoUrl}/raw/main/docs/assets/screenshots/dashboard.png`} alt="Sunrise inbox screenshot" loading="lazy" /></figure></section>{props.setup ? <SetupGuide setup={props.setup} /> : null}</>;
}
