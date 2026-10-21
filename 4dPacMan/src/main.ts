import './style.css'
import { Audio } from './audio'
import type { Preset } from './rot4'
import { CHAPTERS, LEVELS, currentLevel, levelOptimal, isUnlocked, levelById, loadProgress, nextLevel, recordFinish, saveProgress, stars, type Level } from './levels'
import { AXIS_NAMES, Round, type MoveResult } from './space'
import { AXIS_COLORS, AXIS_KEYS, GUIDE_NEAR, View } from './view'

type Mode = 'intro' | 'select' | 'playing' | 'won'

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!
const params = new URLSearchParams(location.search)

// ── DOM ─────────────────────────────────────────────────────────────────
const axisChip = (a: number, inner: string) => `<span class="chip" style="--c:${AXIS_COLORS[a]}">${inner}</span>`
const PRESETS: [Preset, string][] = [['oblique', '斜视'], ['hideW', '藏 W'], ['hideZ', '藏 Z'], ['hideY', '藏 Y'], ['hideX', '藏 X']]

$('#ui').innerHTML = `
  <header class="bar">
    <div class="brand"><b>4D</b><em id="lvl-id"></em><span id="lvl-name"></span></div>
    <div class="pips" id="pips" aria-label="剩余目标"></div>
    <div class="bar-right">
      <div class="moves" id="moves"></div>
      <button class="icon" id="btn-levels" aria-label="关卡" title="关卡 (L)"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg></button>
      <button class="icon" id="btn-new" aria-label="重玩本关" title="重玩 (N)"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>
      <button class="icon" id="btn-help" aria-label="玩法说明" title="玩法 (H)"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><path d="M12 17.5h.01"/></svg></button>
      <button class="icon" id="btn-mute" aria-label="静音"></button>
    </div>
  </header>
  <aside class="viewpanel" aria-label="视图">
    <div class="vp-title">四维视角</div>
    <div class="presets">${PRESETS.map(([p, t]) => `<button class="pill" data-preset="${p}">${t}</button>`).join('')}</div>
    <div class="toggles">
      <button class="pill toggle" id="tg-drag" aria-pressed="false"><i></i>拖动 = 4D 旋转</button>
      <button class="pill toggle" id="tg-spin" aria-pressed="false"><i></i>自动 4D 旋转</button>
      <button class="pill toggle" id="tg-center" aria-pressed="false" title="白球固定在中心，移动时世界随之移动 (C)"><i></i>玩家第一人称视角</button>
      <div class="seg" role="radiogroup" aria-label="导引线">
        <span>导引线</span>
        <button class="seg-btn" data-guide="off" role="radio" aria-checked="false">关</button>
        <button class="seg-btn on" data-guide="near" role="radio" aria-checked="true" title="离目标 ${GUIDE_NEAR} 格以内才显示">靠近</button>
        <button class="seg-btn" data-guide="always" role="radio" aria-checked="false">始终</button>
      </div>
      <button class="pill toggle on" id="tg-labels" aria-pressed="true"><i></i>按键提示</button>
      <label class="pill range" id="rg-wrap" title="按键提示与小球的距离"><span>提示距离</span><input type="range" id="rg-labdist" min="4" max="120" step="2" aria-label="按键提示与小球的距离" /></label>
      <button class="pill" id="btn-cam">重置镜头</button>
    </div>
  </aside>
  <canvas class="gizmo" id="gizmo" aria-hidden="true"></canvas>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <footer class="bottom">
    <div class="legend">
      ${[0, 1, 2, 3].map(a => axisChip(a, `<b>${AXIS_NAMES[a]}</b><kbd>${AXIS_KEYS[a][0]}</kbd><kbd>${AXIS_KEYS[a][1]}</kbd>`)).join('')}
      <span class="hint">左键拖动 转镜头 · <b>右键</b>或 <kbd>Shift</kbd>+拖动 转第四维 · 滚轮缩放</span>
    </div>
    <div class="pad">
      ${[0, 1, 2, 3].map(a => `
        <div class="axis-col" style="--c:${AXIS_COLORS[a]}">
          <button class="pad-btn" data-axis="${a}" data-dir="1" aria-label="${AXIS_NAMES[a]} 正方向">${AXIS_NAMES[a]}+</button>
          <button class="pad-btn" data-axis="${a}" data-dir="-1" aria-label="${AXIS_NAMES[a]} 负方向">${AXIS_NAMES[a]}−</button>
        </div>`).join('')}
    </div>
  </footer>
  <div class="overlay" id="overlay"></div>
  <aside class="debug" id="debug"></aside>`

const canvas = $<HTMLCanvasElement>('#gl')
const view = new View(canvas, $<HTMLCanvasElement>('#gizmo'))
const audio = new Audio()

const store = (() => {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
})()
const progress = loadProgress(store)
// TEMP: every ready level is selectable while levels are being designed. Set to
// `params.has('unlock')` to restore sequential unlocking.
const UNLOCK_ALL_LEVELS = true
const unlockAll = UNLOCK_ALL_LEVELS || params.has('unlock')

let mode: Mode = 'intro'
/** Current level, or null for free play (random seed). */
let level: Level | null = null
let round = makeRound(null, 0)
let method: 'keyboard' | 'touch' = matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard'
let muted = false

function randomSeed(): number {
  return Math.floor(Math.random() * 1e9)
}
function seedFromUrl(): number | null {
  const s = params.get('seed')
  return s !== null && /^\d+$/.test(s) ? Number(s) : null
}

// ── Round lifecycle ─────────────────────────────────────────────────────
function makeRound(l: Level | null, seed: number): Round {
  return l ? new Round(l.seed, l.targets, l.start, l.opts) : new Round(seed, 5)
}

/** Start a level (or free play when `l` is null). */
function startLevel(l: Level | null, seed = randomSeed()): void {
  level = l
  round = makeRound(l, seed)
  view.setRound(round.pos, round.targets, round.extent, round.obstacles)
  mode = 'playing'
  hideOverlay()
  refresh()
  if (l) toast(`<b>${l.id}</b> ${l.name} · ${l.brief}`, 2600)
}

/** Restart: same level layout; free play gets a fresh random layout. */
function restart(): void {
  startLevel(level)
}

function refresh(): void {
  $('#lvl-id').textContent = level ? level.id : '∞'
  $('#lvl-name').textContent = level ? level.name : '随机练习'
  $('#pips').innerHTML = round.collected.map(c => `<i class="${c ? 'got' : ''}"></i>`).join('')
  $('#moves').innerHTML = `<span>步数</span><b>${round.moves}</b><small>最优 ${round.optimal}</small>`
  view.setNearest(round.nearest())
  view.setGuide(round.guidePath())
  view.setBlocked(round.blockedMask())
  renderDebug()
}

function move(axis: number, dir: number): void {
  if (mode !== 'playing') return
  handle(round.tryMove(axis, dir), axis)
}

function handle(r: MoveResult, axis: number): void {
  if (r.kind === 'ignored') return
  if (r.kind === 'edge') {
    view.edgeBump(r.axis, r.dir)
    audio.play('bump')
    toast(`已到达 <b style="color:${AXIS_COLORS[r.axis]}">${AXIS_NAMES[r.axis]}</b> 轴的边界`)
    return
  }
  if (r.kind === 'blocked') {
    view.edgeBump(r.axis, r.dir)
    view.flashObstacle(r.obstacle)
    audio.play('phaseBlocked')
    toast(`<b style="color:${AXIS_COLORS[r.axis]}">${AXIS_NAMES[r.axis]}${r.dir > 0 ? '+' : '−'}</b> 方向被障碍物挡住了`)
    return
  }
  view.movePlayer(r.to)
  audio.play(axis === 3 ? 'phase' : 'step', axis === 3 ? r.to[3] - r.from[3] : axis * 2)
  if (r.collected >= 0) {
    view.collect(r.collected)
    audio.play('collect', (round.targets.length - round.remaining) * 2)
  }
  refresh()
  if (r.won) win()
}

const starRow = (n: number, max = 3) => `<span class="stars" aria-label="${n} 星">${[...Array(max)].map((_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`

function win(): void {
  mode = 'won'
  view.celebrate()
  audio.play('win')
  const perfect = round.moves <= round.optimal
  const st = stars(round.moves, round.optimal)
  const l = level
  let newBest = false
  if (l) {
    newBest = recordFinish(progress, l.id, round.moves)
    saveProgress(store, progress)
  }
  const next = l ? nextLevel(l.id) : undefined
  const canNext = !!next && isUnlocked(progress, next.id, unlockAll)
  window.setTimeout(() => {
    showOverlay(`
      <div class="panel win">
        <small>${l ? `关卡 ${l.id} · ${l.name}` : '随机练习'}</small>
        <h2>${perfect ? '完美路线！' : '完成！'}</h2>
        ${starRow(st)}
        <div class="stats"><div><span>你的步数</span><b>${round.moves}</b></div><div><span>最优步数</span><b>${round.optimal}</b></div></div>
        <p class="muted">${perfect ? '你找到了最短的收集顺序。' : `比最优多走了 ${round.moves - round.optimal} 步——试试先规划收集顺序。`}${newBest && l ? ' <b class="pink">新纪录</b>' : ''}</p>
        ${next && !next.ready ? `<p class="muted">下一章「${CHAPTERS[next.chapter - 1].name}」即将推出。</p>` : ''}
        <div class="row">
          ${l && canNext ? `<button class="btn primary" id="ov-next">下一关 ${next!.id}</button>` : ''}
          <button class="btn ${l && canNext ? '' : 'primary'}" id="ov-again">${l ? '重玩本关' : '再来一局'}</button>
          <button class="btn" id="ov-levels">关卡列表</button>
        </div>
      </div>`)
    if (canNext) $('#ov-next').onclick = () => startLevel(next!)
    $('#ov-again').onclick = () => restart()
    $('#ov-levels').onclick = () => openSelect()
    $<HTMLButtonElement>('#overlay .btn.primary').focus()
  }, 700)
}

// ── Level select ────────────────────────────────────────────────────────
function openSelect(): void {
  mode = 'select'
  const cur = currentLevel(progress)
  const chapters = CHAPTERS.map(c => {
    const ls = LEVELS.filter(l => l.chapter === c.id)
    const ready = ls.some(l => l.ready)
    const cards = ls
      .map(l => {
        const open = isUnlocked(progress, l.id, unlockAll)
        const best = progress.best[l.id]
        const st = best !== undefined ? stars(best, levelOptimal(l)) : 0
        const size = `${2 * (l.opts.extent ?? 12) + 1} 格`
        const label = !l.ready ? '即将推出' : !open ? '未解锁' : best !== undefined ? `最佳 ${best} 步 · ${size}` : `${l.targets} 个目标 · ${size}`
        return `<button class="lvl ${open ? '' : 'locked'} ${l.id === cur.id && open ? 'current' : ''}" data-level="${l.id}" ${open ? '' : 'disabled'} aria-label="关卡 ${l.id} ${l.name}，${label}">
          <span class="lvl-id">${open ? l.id : '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'}</span>
          <span class="lvl-name">${l.name}</span>
          ${starRow(st)}
          <span class="lvl-sub">${label}</span>
        </button>`
      })
      .join('')
    return `<section class="chapter ${ready ? '' : 'soon'}">
      <div class="ch-head"><b>第 ${c.id} 章 · ${c.name}</b>${ready ? '' : '<em>即将推出</em>'}</div>
      <p class="muted">${c.blurb}</p>
      <div class="lvl-grid">${cards}</div>
    </section>`
  }).join('')
  showOverlay(`
    <div class="panel select">
      <small>选择关卡</small>
      <h2>四维寻路</h2>
      ${chapters}
      <div class="row">
        <button class="btn primary" id="ov-continue">${cur.id in progress.best ? '继续' : '开始'} ${cur.id} ${cur.name}</button>
        <button class="btn" id="ov-free">随机练习</button>
        <button class="btn" id="ov-help">玩法</button>
      </div>
    </div>`)
  document.querySelectorAll<HTMLButtonElement>('[data-level]').forEach(b => (b.onclick = () => startLevel(levelById(b.dataset.level!)!)))
  $('#ov-continue').onclick = () => startLevel(cur)
  $('#ov-free').onclick = () => startLevel(null)
  $('#ov-help').onclick = () => intro()
  $('#ov-continue').focus({ preventScroll: true })
  $('#overlay').scrollTop = 0
}

// ── Overlays ────────────────────────────────────────────────────────────
function showOverlay(html: string): void {
  const o = $('#overlay')
  o.innerHTML = html
  o.classList.add('open')
}
function hideOverlay(): void {
  $('#overlay').classList.remove('open')
}

function intro(): void {
  const fromSelect = mode === 'select'
  mode = 'intro'
  const kb = method === 'keyboard'
  const controls = [0, 1, 2, 3]
    .map(a => axisChip(a, `<b>${AXIS_NAMES[a]}</b>${kb ? `<kbd>${AXIS_KEYS[a][0]}</kbd><kbd>${AXIS_KEYS[a][1]}</kbd>` : '−/+'}`))
    .join('')
  showOverlay(`
    <div class="panel intro">
      <small>玩法</small>
      <h2>在四维空间里移动</h2>
      <p>空间有 <b>四个方向</b>：${controls}</p>
      <p>白色小球是你，<b class="pink">粉色发光小球</b>是目标。每按一次沿某个方向走一格，走到目标所在位置就能收集它。</p>
      <p><b class="obst">灰蓝色的棱角立体</b>是障碍物：它是四维物体穿过你所在位置的<b>三维切面</b>，淡淡的线框是整个四维形状。被挡住的方向，按键提示会变灰。</p>
      <ul>
        <li><b>穿过你的四条彩色线</b>就是四个方向，线的两端标着该按哪个${kb ? '键' : '按钮'}（可在右侧面板隐藏）。</li>
        <li><b>虚线导引</b>指向最近的目标：每段的颜色是要走的方向，长度是要走的距离。</li>
        <li>${kb ? '左键拖动' : '单指拖动'}自由旋转镜头；${kb ? '<b>右键拖动</b>（或 Shift+拖动）' : '打开「拖动 = 4D 旋转」后拖动'}会在四维里旋转整个空间。</li>
        <li>打开右侧「玩家第一人称视角」${kb ? '（<kbd>C</kbd>）' : ''}，白球固定在画面中心，移动时目标和障碍物会反向移动。</li>
        <li>两个小球在画面上重合，不代表它们在同一位置——转一转第四维就知道了。</li>
      </ul>
      <button class="btn primary" id="ov-start">${fromSelect ? '返回关卡' : round.moves ? '继续' : '开始'}</button>
    </div>`)
  $('#ov-start').onclick = () => {
    audio.unlock()
    // Opened from the level list → back there; otherwise resume (or begin) the loaded round.
    if (fromSelect || round.won) return openSelect()
    const fresh = round.moves === 0
    mode = 'playing'
    hideOverlay()
    refresh()
    if (fresh && level) toast(`<b>${level.id}</b> ${level.name} · ${level.brief}`, 2600)
  }
  $('#ov-start').focus()
}

let toastTimer = 0
function toast(html: string, ms = 1400): void {
  const t = $('#toast')
  t.innerHTML = html
  t.classList.add('show')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => t.classList.remove('show'), ms)
}

// ── Debug panel (hidden unless ` or ?debug) ─────────────────────────────
let debugOn = params.has('debug')
function renderDebug(): void {
  const d = $('#debug')
  d.classList.toggle('open', debugOn)
  if (!debugOn) return
  const fmt = (p: number[]) => `(${p.join(', ')})`
  const m = Array.from(view.M, v => v.toFixed(2).padStart(5))
  d.innerHTML = `
    <div class="dh">DEBUG <small>\` 切换</small></div>
    <div>pos ${fmt(round.pos)}</div>
    <div>level ${level?.id ?? 'free'} · seed ${round.seed} · extent ±${round.extent}</div>
    <div>moves ${round.moves} / opt ${round.optimal}</div>
    <div>targets</div>
    ${round.targets.map((t, i) => `<div class="${round.collected[i] ? 'got' : ''}">&nbsp; ${i === round.nearest() ? '▶' : '·'} ${fmt(t)}</div>`).join('')}
    <div>view M</div><pre>${[0, 1, 2, 3].map(r => m.slice(r * 4, r * 4 + 4).join(' ')).join('\n')}</pre>`
}

// ── Input ───────────────────────────────────────────────────────────────
function setMethod(m: 'keyboard' | 'touch'): void {
  if (m === method && document.body.classList.contains(m)) return
  method = m
  document.body.classList.toggle('touch', m === 'touch')
  document.body.classList.toggle('keyboard', m === 'keyboard')
  view.setLabelMode(m)
}
setMethod(method)
document.body.classList.add(method)
window.addEventListener('pointerdown', e => setMethod(e.pointerType === 'mouse' ? 'keyboard' : 'touch'), { capture: true })

const KEYMAP: Record<string, [number, number]> = {}
AXIS_KEYS.forEach(([neg, pos], a) => {
  KEYMAP['Key' + neg] = [a, -1]
  KEYMAP['Key' + pos] = [a, 1]
})

/** Press-and-hold auto-repeat shared by keys and on-screen buttons. */
const held = new Map<string, number>()
function press(id: string, fn: () => void): void {
  release(id)
  fn()
  held.set(id, window.setTimeout(() => held.set(id, window.setInterval(fn, 110)), 280))
}
function release(id: string): void {
  const t = held.get(id)
  if (t === undefined) return
  window.clearTimeout(t)
  window.clearInterval(t)
  held.delete(id)
}
const releaseAll = () => [...held.keys()].forEach(release)

window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const k = KEYMAP[e.code]
  if (k) {
    e.preventDefault()
    setMethod('keyboard')
    if (!e.repeat) press('k' + e.code, () => move(k[0], k[1]))
    return
  }
  if (e.repeat) return
  const digit = /^Digit([1-5])$/.exec(e.code)
  if (digit) return view.goPreset(PRESETS[Number(digit[1]) - 1][0])
  switch (e.code) {
    case 'Backquote':
      debugOn = !debugOn
      return renderDebug()
    case 'KeyN':
      return restart()
    case 'KeyL':
      return openSelect()
    case 'KeyH':
      return intro()
    case 'KeyG':
      return setGuide(view.showGuide ? (view.guideMode === 'near' ? 'always' : 'off') : 'near')
    case 'KeyT':
      return toggle('spin')
    case 'KeyC':
      return toggle('center')
    case 'KeyK':
      return toggle('labels')
    case 'Enter':
      if ($('#overlay').classList.contains('open')) $<HTMLButtonElement>('#overlay .btn.primary')?.click()
      return
  }
})
window.addEventListener('keyup', e => release('k' + e.code))
window.addEventListener('blur', releaseAll)
document.addEventListener('visibilitychange', releaseAll)

document.querySelectorAll<HTMLButtonElement>('.pad-btn').forEach(b => {
  const id = 'b' + b.dataset.axis + b.dataset.dir
  const axis = Number(b.dataset.axis)
  const dir = Number(b.dataset.dir)
  b.addEventListener('pointerdown', e => {
    e.preventDefault()
    audio.unlock()
    b.setPointerCapture(e.pointerId)
    b.classList.add('pressed')
    press(id, () => move(axis, dir))
  })
  const up = () => {
    b.classList.remove('pressed')
    release(id)
  }
  b.addEventListener('pointerup', up)
  b.addEventListener('pointercancel', up)
  b.addEventListener('lostpointercapture', up)
  b.addEventListener('contextmenu', e => e.preventDefault())
})

type GuideMode = 'off' | 'near' | 'always'
function setGuide(m: GuideMode): void {
  view.showGuide = m !== 'off'
  if (m !== 'off') view.guideMode = m
  document.querySelectorAll<HTMLButtonElement>('[data-guide]').forEach(b => {
    const on = b.dataset.guide === m
    b.classList.toggle('on', on)
    b.setAttribute('aria-checked', String(on))
  })
}
document.querySelectorAll<HTMLButtonElement>('[data-guide]').forEach(b => (b.onclick = () => setGuide(b.dataset.guide as GuideMode)))

function toggle(which: 'drag' | 'spin' | 'center' | 'labels'): void {
  const el = $(`#tg-${which}`)
  let on: boolean
  if (which === 'drag') on = view.drag4D = !view.drag4D
  else if (which === 'spin') on = view.autoSpin = !view.autoSpin
  else if (which === 'center') on = view.centered = !view.centered
  else on = view.showLabels = !view.showLabels
  el.classList.toggle('on', on)
  el.setAttribute('aria-pressed', String(on))
  document.body.classList.toggle('drag4d', view.drag4D)
  document.body.classList.toggle('labels-off', !view.showLabels)
}
$('#tg-drag').onclick = () => toggle('drag')
$('#tg-spin').onclick = () => toggle('spin')
$('#tg-center').onclick = () => toggle('center')
$('#tg-labels').onclick = () => toggle('labels')
$('#btn-cam').onclick = () => view.resetCamera()
// Label distance slider (persisted).
const LABGAP_KEY = '4d-labgap'
const labRange = $<HTMLInputElement>('#rg-labdist')
const savedGap = Number(store?.getItem(LABGAP_KEY))
view.labelGap = savedGap >= 4 && savedGap <= 120 ? savedGap : 26
labRange.value = String(view.labelGap)
labRange.addEventListener('input', () => {
  view.labelGap = Number(labRange.value)
  try {
    store?.setItem(LABGAP_KEY, labRange.value)
  } catch {
    // Storage unavailable: setting just isn't remembered.
  }
})
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(b => (b.onclick = () => view.goPreset(b.dataset.preset as Preset)))
$('#btn-new').onclick = () => restart()
$('#btn-levels').onclick = () => openSelect()
$('#btn-help').onclick = () => intro()
const setMuted = (m: boolean) => {
  muted = m
  audio.setMuted(m)
  $('#btn-mute').innerHTML = m
    ? '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>'
}
$('#btn-mute').onclick = () => setMuted(!muted)
setMuted(false)
view.onUserRotate4D = () => {
  if (view.autoSpin) toggle('spin')
}

window.addEventListener('resize', () => view.resize())
new ResizeObserver(() => view.resize()).observe(canvas)

// ── Loop ────────────────────────────────────────────────────────────────
// URL: ?seed=N → free play with that layout; ?level=1-3 → that level (if unlocked, or with ?unlock).
const urlSeed = seedFromUrl()
const urlLevel = levelById(params.get('level') ?? '')
if (urlSeed !== null) level = null
else level = urlLevel && isUnlocked(progress, urlLevel.id, unlockAll) ? urlLevel : currentLevel(progress)
round = makeRound(level, urlSeed ?? randomSeed())
view.setRound(round.pos, round.targets, round.extent, round.obstacles)
refresh()
let last = performance.now()
let dbgTimer = 0
function frame(now: number): void {
  // rAF timestamps can precede the performance.now() taken at startup → never let dt go negative.
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000))
  last = now
  view.update(dt)
  if (debugOn && (dbgTimer += dt) > 0.25) {
    dbgTimer = 0
    renderDebug()
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
if (params.has('play')) {
  mode = 'playing'
  if (level) toast(`<b>${level.id}</b> ${level.name} · ${level.brief}`, 2600)
} else if (urlSeed !== null || urlLevel) intro()
else openSelect() // Start page = level select; rules are behind the 「玩法」 button.

// Test hook for automated checks.
;(window as unknown as Record<string, unknown>).__game = {
  state: () => ({ mode, level: level?.id ?? null, guide: round.guidePath(), blocked: round.blockedMask(), pos: round.pos, moves: round.moves, optimal: round.optimal, remaining: round.remaining, targets: round.targets.filter((_, i) => !round.collected[i]) }),
  move,
  startLevel: (id: string | null) => startLevel(id ? levelById(id)! : null),
  openSelect,
  view,
}
