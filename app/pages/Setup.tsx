import { Head } from '@ts-76/inertia-hono-jsx';
import { SetupGuide } from './_shared';

export default function Setup(props: any) {
  return <><Head title="Setup" /><SetupGuide setup={props.setup} /></>;
}
