// Headless playthrough + screenshots using the system Chrome (no browser download needed).
// Usage: npm run build && npm run shots   (serves dist/ via `vite preview`)
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright-core'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 4173
const URL = `http://127.0.0.1:${PORT}/`
mkdirSync('shots', { recursive: true })

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'pipe' })
await new Promise((res, rej) => {
  server.stdout.on('data', d => String(d).includes(String(PORT)) && res())
  server.on('exit', c => rej(new Error('preview exited ' + c)))
  setTimeout(() => rej(new Error('preview timeout')), 15000)
})

const errors = []
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const wait = ms => new Promise(r => setTimeout(r, ms))

async function session(name, ctxOpts, fn) {
  const ctx = await browser.newContext(ctxOpts)
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`))
  page.on('console', m => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`))
  await fn(page)
  await ctx.close()
}

const state = page => page.evaluate(() => window.__game.state())
const act = (page, a) => page.evaluate(a => window.__game.act(a), a)

// Desktop
await session('desktop', { viewport: { width: 1440, height: 900 } }, async page => {
  await page.goto(URL)
  await wait(1200)
  await page.screenshot({ path: 'shots/d1-title.png' })
  await page.click('[data-k=play]')
  await wait(2200)
  await page.screenshot({ path: 'shots/d2-level1.png' })
  // Keyboard: play level 1 by real key presses (D D D moves right along the top row...).
  for (const k of ['KeyD', 'KeyD', 'KeyS']) { await page.keyboard.press(k); await wait(180) }
  const s1 = await state(page)
  console.log('after keys', JSON.stringify(s1))
  if (s1.moves < 1) errors.push('keyboard moves did not register')

  // Jump to level 3 (phase tutorial) and phase through W.
  await page.goto(URL + '?level=3')
  await wait(2200)
  await page.screenshot({ path: 'shots/d3-phase-tutorial.png' })
  await page.keyboard.press('KeyE')
  await wait(250)
  await page.screenshot({ path: 'shots/d4-phase-mid.png' })
  await wait(500)
  await page.screenshot({ path: 'shots/d5-phase-after.png' })
  const s3 = await state(page)
  if (s3.pos[3] !== 1) errors.push('KeyE did not change W: ' + JSON.stringify(s3))

  // Ghost level with debug panel and solution overlay.
  await page.goto(URL + '?level=4&debug')
  await wait(2200)
  await page.click('text=显示解')
  await wait(300)
  await page.screenshot({ path: 'shots/d6-ghost-debug.png' })

  // Generated level, auto-solve via debug stepping to verify the win flow.
  await page.goto(URL + '?level=8&debug')
  await wait(2200)
  await page.screenshot({ path: 'shots/d7-level8.png' })
  for (let i = 0; i < 200; i += 1) {
    const s = await state(page)
    if (s.mode !== 'playing') break
    await page.click('text=自动走一步')
  }
  await wait(1400)
  const won = await state(page)
  if (won.mode !== 'won') errors.push('auto-solve did not win: ' + JSON.stringify(won))
  if (won.moves !== won.par) errors.push(`auto-solve moves ${won.moves} != par ${won.par}`)
  await page.screenshot({ path: 'shots/d8-win.png' })

  await page.goto(URL + '?level=1')
  await wait(500)
  await page.keyboard.press('KeyH')
  await wait(500)
  await page.screenshot({ path: 'shots/d9-help.png' })
})

// Mobile (iPhone 13 profile: touch, coarse pointer)
await session('mobile', { ...devices['iPhone 13'] }, async page => {
  await page.goto(URL)
  await wait(1200)
  await page.screenshot({ path: 'shots/m1-title.png' })
  await page.tap('[data-k=play]')
  await wait(2200)
  await page.screenshot({ path: 'shots/m2-level1.png' })
  await page.tap('.d-right')
  await wait(200)
  const s = await state(page)
  if (s.moves !== 1) errors.push('touch d-pad did not move: ' + JSON.stringify(s))

  await page.goto(URL + '?level=6')
  await wait(2200)
  await page.screenshot({ path: 'shots/m3-level6.png' })
  const before = (await state(page)).pos[3]
  await page.tap('.w-btn:not([disabled])')
  await wait(700)
  await page.screenshot({ path: 'shots/m4-level6-phase.png' })
  const after = await state(page)
  if (after.pos[3] === before && after.moves === 0) {
    // Tap may have hit a blocked slice; that's acceptable but should show the toast.
    const toast = await page.textContent('.toast')
    if (!toast) errors.push('W button did nothing')
  }
  await page.goto(URL + '?level=9')
  await wait(2200)
  await page.screenshot({ path: 'shots/m5-level9.png' })
})

await session('mobile-landscape', { ...devices['iPhone 13 landscape'] }, async page => {
  await page.goto(URL + '?level=6')
  await wait(2200)
  await page.screenshot({ path: 'shots/m6-landscape.png' })
})

await browser.close()
server.kill()
if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'))
  process.exit(1)
}
console.log('shots ok')
