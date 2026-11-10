import { defineConfig } from "vite"
import { sthUiVite } from "./sthUi.ts"

export default defineConfig({
  ...sthUiVite,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: "index.html",
      output: { entryFileNames: "app.bundle", assetFileNames: "app.[ext]" }
    }
  }
})
