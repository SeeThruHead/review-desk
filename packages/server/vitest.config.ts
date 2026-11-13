import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "server",
    include: ["src/**/*.test.ts"],
    testTimeout: 20_000,
    coverage: {
      enabled: true,
      provider: "istanbul",
      include: [
        "src/desk/Plan.ts",
        "src/desk/Messages.ts",
        "src/desk/BranchWatch.ts",
        "src/forge/GitHubSearch.ts",
        "src/forge/GitHubPoll.ts",
        "src/desk/IssueWatch.ts",
        "src/desk/Repos.ts",
        "src/agents/Remote.ts",
        "src/agents/Address.ts",
        "src/agents/Host.ts",
        "src/agents/Hosts.ts",
        "src/agents/hosts/*.ts",
        "src/store/DeskRepo.ts",
        "src/desk/Health.ts",
        "src/desk/Gone.ts"
      ],
      reporter: ["text-summary", "text"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 }
    }
  }
})
