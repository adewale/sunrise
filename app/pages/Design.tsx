type Props = { __sunriseHtml?: string };

export default function Design({ __sunriseHtml = '' }: Props) {
  return <div className="inertia-page" data-page-component="Design" dangerouslySetInnerHTML={{ __html: __sunriseHtml }} />;
}
