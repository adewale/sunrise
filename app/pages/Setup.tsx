type Props = { __sunriseHtml?: string };

export default function Setup({ __sunriseHtml = '' }: Props) {
  return <div className="inertia-page" data-page-component="Setup" dangerouslySetInnerHTML={{ __html: __sunriseHtml }} />;
}
