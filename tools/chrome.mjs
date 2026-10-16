// Finds a local Chrome or Chromium for the puppeteer-core test and screenshot tools.
// Set CHROME_PATH to override, e.g. CHROME_PATH=/usr/bin/chromium node tools/offline-test.mjs
import fs from 'node:fs'

const CANDIDATES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
}

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const found = (CANDIDATES[process.platform] || []).find((p) => fs.existsSync(p))
  if (!found) throw new Error('No Chrome found. Install Google Chrome or set CHROME_PATH to a Chrome / Chromium executable.')
  return found
}
