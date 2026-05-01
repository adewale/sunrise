type Props = { __sunriseHtml?: string };

export default function Landing({ __sunriseHtml = '' }: Props) {
  return <div className="inertia-page" data-page-component="Landing" dangerouslySetInnerHTML={{ __html: __sunriseHtml }} />;
}
