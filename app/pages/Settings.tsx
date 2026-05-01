export default function Settings(props: any) {
  const pageSize = props.settings?.inboxPageSize ?? 50;
  return <section className="section panel settings-panel"><div className="section-head"><div><p className="eyebrow">Preferences</p><h1>Settings</h1><p className="muted">Keep Sunrise quiet, skimmable, and tuned to how much GitHub you want at once.</p></div></div><form method="post" action="/settings" className="settings-form"><label><span>Inbox page size</span><select name="inboxPageSize" defaultValue={pageSize}>{[25, 50, 100].map((n) => <option value={n} key={n}>{n} events</option>)}</select></label><p className="muted">Pagination starts after this many events. Default is 50.</p><button className="button primary">Save settings</button></form></section>;
}
