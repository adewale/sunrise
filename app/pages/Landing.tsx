import { SetupGuide } from './_shared';

export default function Landing(props: any) {
  const repoUrl = String(props.repoUrl ?? 'https://github.com/adewale/sunrise').replace(/\/$/, '');
  return <><section className="hero panel"><p className="actions"><a className="button primary" href={repoUrl}>Deploy your own</a>{props.projectLanding ? null : <> <a className="button ghost" href="/login">Sign in with GitHub</a></>}</p><p className="muted">Single-user, read-only by default, and your snapshots stay in your Cloudflare account.</p><figure className="product-shot"><img src={`${repoUrl}/raw/main/docs/assets/screenshots/dashboard.png`} alt="Sunrise inbox screenshot" loading="lazy" /></figure></section>{props.setup ? <SetupGuide setup={props.setup} /> : null}</>;
}
