import { defineConfig } from "vitest/config"
import { sthUiVite } from "./sthUi.ts"

export default defineConfig({
  ...sthUiVite,
  test: {
    name: "web-logic",
    include: ["src/**/*.test.ts"],
    testTimeout: 20_000,
    coverage: {
      enabled: true,
      provider: "istanbul",
      include: ["src/pages/**/update.ts", "src/pages/**/model.ts"],
      reporter: ["text-summary"],
      reportsDirectory: "coverage/logic",
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 }
    }
  }
})
