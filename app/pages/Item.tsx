import { Item } from './_shared';

export default function ItemPage(props: any) {
  const item = props.item;
  return <section className="section panel"><div className="section-head"><div><p className="eyebrow">Inbox card</p><h1>{item ? 'GitHub loop' : 'Not found'}</h1><p className="muted">Open this card in its own tab, share the Sunrise URL, or continue through to GitHub.</p></div><a className="button ghost" href="/dashboard">Back to inbox</a></div>{item ? <div className="item-list"><Item item={item} ownerLogin={props.signedInAs} /></div> : <div className="empty-state"><strong>Card not found.</strong><p>This item may have been resolved or ignored.</p></div>}</section>;
}
