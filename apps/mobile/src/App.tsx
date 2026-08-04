import { HomeScreen } from './screens/HomeScreen';

/**
 * Root component. Navigation arrives in Stage 1 with the second screen —
 * a router for one screen is scaffolding for later (CLAUDE.md rule 1).
 */
export default function App(): React.JSX.Element {
  return <HomeScreen />;
}
