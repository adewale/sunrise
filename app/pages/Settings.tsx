type Props = { __sunriseHtml?: string };

export default function Settings({ __sunriseHtml = '' }: Props) {
  return <div className="inertia-page" data-page-component="Settings" dangerouslySetInnerHTML={{ __html: __sunriseHtml }} />;
}
