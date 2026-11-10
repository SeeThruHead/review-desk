import stylex from "@stylexjs/unplugin/vite"
import { defineConfig } from "vite"

const home = process.env["HOME"] ?? ""

export default defineConfig({
  plugins: [stylex({ enableMediaQueryOrder: false, unstable_moduleResolution: { type: "commonJS", rootDir: `${home}/code` } })],
  resolve: {
    alias: [{ find: /^@sth-ui\/core\/(.*)$/, replacement: `${home}/code/sth-ui/packages/core/src/$1` }],
    dedupe: ["effect", "foldkit", "@foldkit/ui", "@stylexjs/stylex"]
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: "client/main.ts",
      output: { entryFileNames: "app.bundle", assetFileNames: "app.[ext]" }
    }
  }
})
