import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    include: ["__tests__/**/*.test.ts"],
    exclude: ["__tests__/setup/**"],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    globalSetup: ["__tests__/setup/global-setup.ts"],
    setupFiles: ["__tests__/setup/setup-env.ts"],
  },
});
