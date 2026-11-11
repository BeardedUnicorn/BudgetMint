import react from '@vitejs/plugin-react';
import { defineBudgetmintConfig } from '../../vitest.shared';

export default defineBudgetmintConfig({
  packageDir: 'packages/client',
  environment: 'jsdom',
  plugins: [react()],
  setupFiles: ['./src/setupTests.ts'],
});
