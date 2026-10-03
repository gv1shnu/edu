import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: {
    alias: {
      "@edu/shared": resolve("packages/shared/src/index.ts"),
      "@edu/db": resolve("packages/db/src/index.ts"),
    },
  },
  test: { testTimeout: 60000, hookTimeout: 120000 },
});
