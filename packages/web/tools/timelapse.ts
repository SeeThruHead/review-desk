import { existsSync, mkdirSync } from "node:fs"
import { chromium } from "playwright"

const [out, everySeconds = "8", ...urls] = Bun.argv.slice(2)

if (out === undefined || urls.length === 0) {
  console.error(
    "usage: bun tools/timelapse.ts <frames-dir> <every-seconds> <url> [url...]   (touch <frames-dir>/stop to finish)"
  )
  process.exit(2)
}

mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: "chrome" })
const pages = await Promise.all(
  urls.map(async (url) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
    await page.goto(url)
    await page.waitForSelector("main", { timeout: 60_000 })
    return page
  })
)

const capture = async (frame: number): Promise<void> => {
  if (existsSync(`${out}/stop`)) return
  await Promise.all(
    pages.map((page, index) =>
      page.screenshot({ path: `${out}/desk${index}-${String(frame).padStart(5, "0")}.png`, fullPage: false })
    )
  )
  await Bun.sleep(Number(everySeconds) * 1000)

  return capture(frame + 1)
}

await capture(0)
await browser.close()
