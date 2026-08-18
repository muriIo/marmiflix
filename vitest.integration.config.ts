import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    environment: "node",
    setupFiles: ["./vitest.integration.setup.ts"],
    // Integration test files share one live Redis key (queue:state) against the
    // real local Redis/SRH stack - running files in parallel lets them stomp
    // each other's state via beforeEach cleanup. Force strictly sequential
    // execution across files (tests within a file already run sequentially).
    fileParallelism: false,
  },
});
