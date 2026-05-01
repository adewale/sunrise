type Props = { __sunriseHtml?: string };

export default function Runs({ __sunriseHtml = '' }: Props) {
  return <div className="inertia-page" data-page-component="Runs" dangerouslySetInnerHTML={{ __html: __sunriseHtml }} />;
}
