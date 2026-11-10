const target = Bun.argv[2] ?? "bun"
const outfile = Bun.argv[3] ?? "dist/review-desk"

const signsHere = process.platform === "darwin" && (target === "bun" || target.startsWith("bun-darwin"))

const run = (command: ReadonlyArray<string>, cwd = ".") =>
  Bun.spawnSync([...command], { cwd, stdout: "inherit", stderr: "inherit" }).exitCode === 0

const steps: ReadonlyArray<() => boolean> = [
  () => run(["bun", "run", "build"], "../web"),
  () =>
    run([
      "bun",
      "build",
      "--compile",
      "--minify",
      `--target=${target}`,
      "--asset-naming=[name].[ext]",
      "src/main.ts",
      "../web/dist/app.bundle",
      "../web/dist/assets/stylex.css",
      "--outfile",
      outfile
    ]),
  () => !signsHere || run(["codesign", "--remove-signature", outfile]),
  () => !signsHere || run(["codesign", "--force", "--sign", "-", outfile])
]

process.exit(steps.every((step) => step()) ? 0 : 1)
