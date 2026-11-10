import { chromium } from "playwright"

const [url, out, width = "1440", height = "1000", scheme = "light"] = Bun.argv.slice(2)

if (url === undefined || out === undefined) {
  console.error("usage: bun tools/screenshot.ts <url> <out.png> [width] [height] [light|dark]")
  process.exit(2)
}

const browser = await chromium.launch({ channel: "chrome" })
const page = await browser.newPage({
  viewport: { width: Number(width), height: Number(height) },
  colorScheme: scheme === "dark" ? "dark" : "light",
  deviceScaleFactor: 2
})
await page.goto(url)
await page.waitForSelector("main, article, section, header", { timeout: 90_000 })
await page.waitForTimeout(1500)
await page.screenshot({ path: out, fullPage: true })
await browser.close()
