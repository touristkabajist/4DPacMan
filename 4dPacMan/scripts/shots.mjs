// Headless checks + screenshots with the system Chrome. Usage: npm run build && npm run shots
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
const state = page => page.evaluate(() => window.__game.state())
const KEYS = [['KeyA', 'KeyD'], ['KeyS', 'KeyW'], ['KeyQ', 'KeyE'], ['KeyF', 'KeyR']]

async function session(name, opts, fn) {
  const ctx = await browser.newContext(opts)
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`))
  page.on('console', m => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`))
  await fn(page)
  await ctx.close()
}

/** Walk to every target with real key presses (greedy nearest), returning the final state. */
async function playWithKeys(page) {
  for (let guard = 0; guard < 1000; guard += 1) {
    const s = await state(page)
    if (s.remaining === 0) return s
    const t = s.targets.map(t => ({ t, d: t.reduce((a, v, i) => a + Math.abs(v - s.pos[i]), 0) })).filter(x => x.d > 0).sort((a, b) => a.d - b.d)[0].t
    const axis = [0, 1, 2, 3].find(a => t[a] !== s.pos[a])
    await page.keyboard.press(KEYS[axis][t[axis] > s.pos[axis] ? 1 : 0])
    await wait(8)
  }
  return state(page)
}

await session('desktop', { viewport: { width: 1440, height: 900 } }, async page => {
  await page.goto(URL + '?seed=42')
  await wait(1000)
  await page.screenshot({ path: 'shots/d1-intro.png' })
  await page.click('#ov-start')
  await page.waitForFunction(() => window.__game.view.moveT >= 1 && !window.__game.view.bump, null, { timeout: 8000 }).catch(() => {})
  await page.screenshot({ path: 'shots/d2-play.png' })

  // Free orbit: left-drag the camera.
  await page.mouse.move(700, 450)
  await page.mouse.down()
  await page.mouse.move(900, 380, { steps: 12 })
  await page.mouse.up()
  await wait(500)
  await page.screenshot({ path: 'shots/d3-orbit.png' })

  // 4D rotation: right-drag.
  const before = await page.evaluate(() => document.querySelector('#gizmo').toDataURL())
  await page.mouse.move(700, 450)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(820, 450, { steps: 12 })
  await page.mouse.up({ button: 'right' })
  await wait(300)
  const after = await page.evaluate(() => document.querySelector('#gizmo').toDataURL())
  if (before === after) errors.push('right-drag did not rotate the 4D view')
  await page.screenshot({ path: 'shots/d4-rot4d.png' })

  await page.click('[data-preset=hideW]')
  await wait(900)
  await page.screenshot({ path: 'shots/d5-hideW.png' })
  await page.click('[data-preset=oblique]')
  await page.click('#btn-cam')
  await wait(900)
  await page.screenshot({ path: 'shots/d5b-labels.png' })
  await page.click('#tg-labels')
  await wait(200)
  if ((await page.getAttribute('#tg-labels', 'aria-pressed')) !== 'false') errors.push('label toggle did not switch off')
  await page.screenshot({ path: 'shots/d5c-nolabels.png' })
  await page.click('#tg-labels')
  await wait(900)
  // Zoom in hard: labels must stay next to the player (not off-screen at the axis ends).
  await page.mouse.move(720, 450)
  for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, -400)
  await wait(900)
  await page.screenshot({ path: 'shots/d5d-zoom.png' })
  await page.click('#btn-cam')
  await page.waitForFunction(() => window.__game.view.moveT >= 1 && !window.__game.view.bump, null, { timeout: 8000 }).catch(() => {})

  const end = await playWithKeys(page)
  if (end.remaining !== 0) errors.push('keyboard play did not collect all targets: ' + JSON.stringify(end))
  await wait(1200)
  if ((await state(page)).mode !== 'won') errors.push('win screen not reached')
  await page.screenshot({ path: 'shots/d6-win.png' })

  await page.goto(URL + '?seed=42&debug&play')
  await wait(800)
  await page.screenshot({ path: 'shots/d7-debug.png' })
})

// Level flow from a fresh profile: level select first → pick 1-1 → win → next → reload shows select.
await session('levels', { viewport: { width: 1440, height: 900 } }, async page => {
  await page.goto(URL)
  await wait(800)
  if ((await state(page)).mode !== 'select') errors.push('start page is not the level select')
  // All ready levels selectable (temporary no-lock mode).
  const locked = await page.$$eval('.lvl.locked', els => els.map(e => e.dataset.level))
  if (locked.length) errors.push('unexpected locks: ' + locked)
  await page.screenshot({ path: 'shots/l0-start.png' })
  await page.click('[data-level="2-3"]')
  await wait(300)
  if ((await state(page)).level !== '2-3') errors.push('could not pick 2-3 directly')
  await page.keyboard.press('KeyL')
  await wait(300)
  await page.click('[data-level="1-1"]')
  await wait(300)
  let s = await state(page)
  if (s.level !== '1-1' || s.mode !== 'playing') errors.push('did not enter 1-1: ' + JSON.stringify(s))
  await page.screenshot({ path: 'shots/l1-level11.png' })
  await playWithKeys(page)
  await wait(1200)
  await page.screenshot({ path: 'shots/l2-win.png' })
  await page.click('#ov-next')
  await wait(300)
  s = await state(page)
  if (s.level !== '1-2') errors.push('next level did not start 1-2: ' + JSON.stringify(s))
  await page.reload()
  await wait(800)
  if ((await state(page)).mode !== 'select') errors.push('reload did not show level select')
  await page.screenshot({ path: 'shots/l3-select.png' })
})

/** Follow the in-game guide path (works around obstacles). */
async function playByGuide(page) {
  for (let guard = 0; guard < 3000; guard += 1) {
    const s = await state(page)
    if (s.remaining === 0) return s
    const nx = s.guide[1]
    const axis = [0, 1, 2, 3].find(a => nx[a] !== s.pos[a])
    await page.keyboard.press(KEYS[axis][nx[axis] > s.pos[axis] ? 1 : 0])
    await wait(6)
  }
  return state(page)
}

// Obstacles: blocked move, slice rendering, presets, label slider, full playthrough.
await session('obstacles', { viewport: { width: 1440, height: 900 } }, async page => {
  await page.goto(URL + '?level=2-1&unlock&play')
  await wait(1000)
  await page.screenshot({ path: 'shots/o1-tesseract.png' })
  // 2-1: tesseract centred at x=3 with half-size 2 → from the origin, X+ is blocked after 0 steps.
  const s0 = await state(page)
  if (!(s0.blocked & (1 << 1))) errors.push('X+ should be blocked at the start of 2-1: ' + s0.blocked)
  await page.keyboard.press('KeyD')
  await wait(200)
  const s1 = await state(page)
  if (s1.moves !== 0 || s1.pos[0] !== 0) errors.push('moved into an obstacle: ' + JSON.stringify(s1))
  await page.screenshot({ path: 'shots/o2-blocked.png' })
  await page.click('[data-preset=hideW]')
  await wait(900)
  await page.screenshot({ path: 'shots/o3-hideW.png' })
  await page.click('[data-preset=oblique]')
  await wait(800)
  // Guide modes: default 'near' hides the line while the target is far; 'always' shows it.
  await page.goto(URL + '?level=1-4&play')
  await wait(900)
  const far = await page.evaluate(() => { const g = window.__game; const s = g.state(); return { vis: g.view.guide.visible, d: Math.min(...s.targets.map(t => Math.hypot(...t.map((v, i) => v - s.pos[i])))) } })
  if (far.d > 6 && far.vis) errors.push('guide visible while far in near-mode: ' + JSON.stringify(far))
  await page.click('[data-guide=always]')
  await wait(200)
  if (!(await page.evaluate(() => window.__game.view.guide.visible))) errors.push('guide not visible in always-mode')
  await page.screenshot({ path: 'shots/o3b-guide-always.png' })
  await page.click('[data-guide=near]')
  await page.goto(URL + '?level=2-1&play')
  await wait(900)
  // Label distance slider.
  await page.$eval('#rg-labdist', el => { el.value = '90'; el.dispatchEvent(new Event('input')) })
  await wait(300)
  await page.screenshot({ path: 'shots/o4-labdist.png' })
  await page.$eval('#rg-labdist', el => { el.value = '26'; el.dispatchEvent(new Event('input')) })
  const end = await playByGuide(page)
  if (end.remaining !== 0) errors.push('2-1 guide play failed: ' + JSON.stringify(end))
  await wait(1200)
  if ((await state(page)).mode !== 'won') errors.push('2-1 win not reached')

  for (const id of ['2-2', '2-3', '2-4', '2-5', '3-1', '3-2', '3-3']) {
    await page.goto(URL + `?level=${id}&unlock&play`)
    await wait(1100)
    await page.screenshot({ path: `shots/o5-${id}.png` })
    const e = await playByGuide(page)
    if (e.remaining !== 0) errors.push(`${id} guide play failed: ` + JSON.stringify({ ...e, guide: undefined }))
    if (e.moves !== e.optimal && id === '2-1') errors.push(`${id}: guide not optimal`)
  }
})

// Player-centred view: the white ball stays at the centre, targets and obstacle slices move instead.
await session('centered', { viewport: { width: 1440, height: 900 } }, async page => {
  await page.goto(URL + '?level=3-2&unlock&play')
  await wait(800)
  const look = () => page.evaluate(() => {
    const v = window.__game.view
    const p = v.player.position
    return { player: [p.x, p.y, p.z], target: v.targetViews[0].mesh.position.toArray(), slice: v.obstacleViews[0].mesh.count }
  })
  // Animations advance per frame (dt is clamped), so in slow headless rendering poll instead of sleeping.
  const centred = on => page.waitForFunction(on => (Math.hypot(...window.__game.view.player.position.toArray()) < 1e-6) === on, on, { timeout: 8000 }).catch(() => {})
  const off = await look()
  await page.click('#tg-center')
  await centred(true)
  const on0 = await look()
  if (Math.hypot(...on0.player) > 1e-6) errors.push('centred view: player not at the centre ' + on0.player)
  if ((await page.getAttribute('#tg-center', 'aria-pressed')) !== 'true') errors.push('centred toggle not pressed')
  await page.screenshot({ path: 'shots/c1-centered.png' })
  for (const k of ['KeyE', 'KeyE', 'KeyR', 'KeyR', 'KeyD']) {
    await page.keyboard.press(k)
    await wait(40)
  }
  await page.waitForFunction(() => window.__game.view.moveT >= 1 && !window.__game.view.bump, null, { timeout: 8000 }).catch(() => {})
  const on1 = await look()
  if (Math.hypot(...on1.player) > 1e-6) errors.push('centred view: player drifted after moving ' + on1.player)
  if (Math.hypot(...on1.target.map((v, i) => v - on0.target[i])) < 1e-3) errors.push('centred view: target did not move with the world')
  if (!on1.slice) errors.push('centred view: Klein slice vanished')
  await page.screenshot({ path: 'shots/c2-centered-moved.png' })
  await page.keyboard.press('KeyC')
  await centred(false)
  const back = await look()
  if (Math.hypot(...back.player) < 1e-3 && Math.hypot(...off.player) > 1e-3) errors.push('C did not turn the centred view off')
})

await session('mobile-levels', { ...devices['iPhone 13'] }, async page => {
  await page.goto(URL + '?unlock')
  await wait(700)
  await page.evaluate(() => window.__game.openSelect())
  await wait(400)
  await page.screenshot({ path: 'shots/m5-select.png' })
})

await session('mobile', { ...devices['iPhone 13'] }, async page => {
  await page.goto(URL + '?seed=7')
  await wait(900)
  await page.screenshot({ path: 'shots/m1-intro.png' })
  await page.tap('#ov-start')
  await page.waitForFunction(() => window.__game.view.moveT >= 1 && !window.__game.view.bump, null, { timeout: 8000 }).catch(() => {})
  await page.screenshot({ path: 'shots/m2-play.png' })
  const s0 = await state(page)
  await page.tap('.pad-btn[data-axis="3"][data-dir="1"]')
  await wait(300)
  const s1 = await state(page)
  if (s1.moves !== s0.moves + 1 || s1.pos[3] !== s0.pos[3] + 1) errors.push('touch W+ did not move: ' + JSON.stringify(s1))
  await page.tap('#tg-drag')
  await wait(200)
  if (!(await page.evaluate(() => document.body.classList.contains('drag4d')))) errors.push('drag-4D toggle failed')
  await page.screenshot({ path: 'shots/m3-drag4d.png' })
})

await session('landscape', { ...devices['iPhone 13 landscape'] }, async page => {
  await page.goto(URL + '?seed=7&play')
  await wait(900)
  await page.screenshot({ path: 'shots/m4-landscape.png' })
})

await browser.close()
server.kill()
if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'))
  process.exit(1)
}
console.log('shots ok')
