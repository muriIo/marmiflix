import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/*.integration.test.ts", "node_modules/**", ".next/**"],
    environment: "node",
  },
});
