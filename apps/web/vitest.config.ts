import react from '@vitejs/plugin-react';
import { defineBudgetmintConfig } from '../../vitest.shared';

export default defineBudgetmintConfig({
  packageDir: 'apps/web',
  environment: 'jsdom',
  plugins: [react()],
  setupFiles: ['./src/setupTests.ts'],
});
