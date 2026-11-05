// Tests run against a fictional world that is not part of the app. The app only loads it when this variable points at it.
import { fileURLToPath } from 'node:url';
process.env.PLEXUS_TEST_WORLD ||= fileURLToPath(new URL('./demo.ts', import.meta.url));
