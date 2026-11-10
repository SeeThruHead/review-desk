import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "domain",
    include: ["src/**/*.test.ts"],
    coverage: {
      enabled: true,
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.testing.ts"],
      reporter: ["text-summary", "text"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 }
    }
  }
})
