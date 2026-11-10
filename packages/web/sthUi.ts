import * as Path from "node:path"
import stylex from "@stylexjs/unplugin/vite"
import type { UserConfig } from "vite"

const repoRoot = Path.resolve(import.meta.dirname, "../..")

export const sthUiVite: UserConfig = {
  plugins: [
    stylex({
      devMode: "full",
      enableMediaQueryOrder: false,
      unstable_moduleResolution: { type: "commonJS", rootDir: repoRoot }
    })
  ],
  resolve: { dedupe: ["effect", "foldkit", "@foldkit/ui", "@stylexjs/stylex"] }
}
