import { Head, type PageComponent } from '@ts-76/inertia-hono-jsx';
import { SetupGuide } from './_shared';

const Setup: PageComponent<'Setup'> = (props) => {
  return <><Head title="Setup" /><SetupGuide setup={props.setup} /></>;
};

export default Setup;
