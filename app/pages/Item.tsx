import { Link } from '@ts-76/inertia-hono-jsx';
import { Item } from './_shared';

export default function ItemPage(props: any) {
  const item = props.item;
  return <section class="section panel"><div class="section-head"><div><p class="eyebrow">Inbox card</p><h1>{item ? 'GitHub loop' : 'Not found'}</h1><p class="muted">Open this card in its own tab, share the Sunrise URL, or continue through to GitHub.</p></div><Link class="button ghost" href="/dashboard">Back to inbox</Link></div>{item ? <div class="item-list"><Item item={item} ownerLogin={props.signedInAs} /></div> : <div class="empty-state"><strong>Card not found.</strong><p>This item may have been resolved or ignored.</p></div>}</section>;
}
