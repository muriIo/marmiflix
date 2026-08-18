import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    environment: "node",
    setupFiles: ["./vitest.integration.setup.ts"],
  },
});
