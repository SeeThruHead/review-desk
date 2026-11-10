const run = (command: ReadonlyArray<string>) => Bun.spawnSync([...command], { stdout: "inherit", stderr: "inherit" }).exitCode

const binary = "dist/review-desk-spike"

const steps: ReadonlyArray<ReadonlyArray<string>> = [
  ["bun", "x", "--bun", "vite", "build"],
  ["bun", "build", "server.ts", "--compile", "--minify", "--outfile", binary],
  ["codesign", "--remove-signature", binary],
  ["codesign", "--force", "--sign", "-", binary]
]

const failed = steps.find((step) => run(step) !== 0)

process.exit(failed === undefined ? 0 : 1)
