import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "lint",
    include: ["*.test.ts", "tools/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      enabled: true,
      provider: "istanbul",
      include: ["tools/attribution.ts"],
      reporter: ["text-summary"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 }
    }
  }
})
