import { storybookTest } from "@storybook/addon-vitest/vitest-plugin"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"
import { sthUiVite } from "./sthUi.ts"

export default defineConfig({
  ...sthUiVite,
  plugins: [...(sthUiVite.plugins ?? []), storybookTest({ configDir: ".storybook" })],
  test: {
    name: "web-components",
    testTimeout: 20_000,
    passWithNoTests: true,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: "chrome", chromiumSandbox: process.env["CI"] !== "true" } }),
      instances: [{ browser: "chromium" }],
      connectTimeout: 60_000
    },
    coverage: {
      enabled: true,
      provider: "istanbul",
      include: ["src/components/**", "src/pages/**/view.ts"],
      exclude: ["**/*.stories.ts", "**/*.test.ts", "**/*.stylex.ts"],
      reporter: ["text-summary", "text"],
      reportsDirectory: "coverage/components",
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 }
    }
  }
})
