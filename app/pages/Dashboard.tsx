type Props = { __sunriseHtml?: string };

export default function Dashboard({ __sunriseHtml = '' }: Props) {
  return <div className="inertia-page" data-page-component="Dashboard" dangerouslySetInnerHTML={{ __html: __sunriseHtml }} />;
}
