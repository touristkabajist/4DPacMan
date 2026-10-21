import './style.css'
import { Audio } from './audio'
import { type Level } from './core/grid'
import { CAMPAIGN_LENGTH, levelAt } from './core/levels'
import { Run, starsFor, type MoveResult } from './core/run'
import { solve } from './core/solver'
import { Input, type Action } from './input'
import { screenToGrid } from './render/basis'
import { sliceHex, sliceName } from './render/palette'
import { SliceView } from './render/scene'
import { DimStrip } from './render/strip'
import { loadSave, writeSave } from './save'
import { keyLabel, Ui } from './ui'

type Mode = 'title' | 'playing' | 'won' | 'menu'

const canvas = document.getElementById('gl') as HTMLCanvasElement
const ui = new Ui(canvas)
const view = new SliceView(canvas)
const strip = new DimStrip(ui.stripHost)
const input = new Input(canvas, view)
const audio = new Audio()
const save = loadSave()
const params = new URLSearchParams(location.search)

let mode: Mode = 'title'
let levelNo = Math.min(save.unlocked, CAMPAIGN_LENGTH - 1)
let level: Level = levelAt(levelNo)
let run = new Run(level)
let par = 0
let solutionShown = false
const parCache = new Map<number, number>()

/** Tutorial coach state for the current attempt. */
const coach = { step: 0, timer: 0, yMoves: 0, wMoves: 0, collected: 0, blockedW: 0, bumps: 0 }

function parFor(n: number, lv: Level): number {
  let p = parCache.get(n)
  if (p === undefined) {
    p = solve(lv)?.par ?? 0
    parCache.set(n, p)
  }
  return p
}

// ── Level lifecycle ─────────────────────────────────────────────────────
function loadLevel(n: number, showCard = true): void {
  levelNo = n
  level = levelAt(n)
  run = new Run(level)
  par = parFor(n, level)
  view.setLevel(level, run.pos, run.mask)
  strip.build(level, input.method === 'keyboard')
  if (showCard) ui.setLevel(n, level)
  solutionShown = false
  view.showSolution(null)
  Object.assign(coach, { step: 0, timer: 0, yMoves: 0, wMoves: 0, collected: 0, blockedW: 0, bumps: 0 })
  refresh()
}

function startLevel(n: number): void {
  audio.unlock()
  mode = 'playing'
  view.title = false
  document.body.classList.remove('in-title')
  ui.showOverlay(null)
  loadLevel(n)
  view.endDrag()
}

function restart(): void {
  if (mode !== 'playing') return
  audio.play('undo')
  loadLevel(levelNo, false)
  ui.toast('重新开始')
}

function refresh(): void {
  ui.update(level, run.pos, run.mask, run.moves, par, run.canUndo)
  ui.setHue(sliceHex(run.pos[3]))
  updateCoach(0)
}

// ── Moves ───────────────────────────────────────────────────────────────
function doMove(axis: number, dir: number): void {
  if (mode !== 'playing') return
  const r = run.tryMove(axis, dir)
  handleResult(r)
}

function handleResult(r: MoveResult): void {
  if (r.kind === 'ignored') return
  if (r.kind === 'blocked') {
    if (r.axis === 3) {
      if (r.outOfBounds) {
        ui.toast(level.size[3] > 1 ? `${dir(r.dir)}没有更多切片了` : '这一关只有一个切片', 'warn')
        view.bump(r.from, r.from)
      } else {
        view.blockedPhase(r.to, r.to[3])
        strip.flashBlocked(r.to[3])
        coach.blockedW += 1
        ui.toast(`<i class="dot" style="--hue:${sliceHex(r.to[3])}"></i>「${sliceName(r.to[3])}」切片的这个位置有墙，无法穿越`, 'warn')
      }
      audio.play('phaseBlocked')
    } else {
      view.bump(r.from, r.to)
      audio.play('bump')
      coach.bumps += 1
      if (r.axis === 1) ui.toast(r.dir > 0 ? (r.outOfBounds ? '已经在最高层' : '上方被挡住了') : r.outOfBounds ? '已经在最底层' : '下方被挡住了', 'warn')
    }
    ui.shakeHud()
    refresh()
    return
  }
  if (r.axis === 3) {
    view.setSlice(r.to[3], r.dir)
    view.movePlayer(r.to)
    audio.play('phase', r.dir)
    coach.wMoves += 1
  } else {
    view.movePlayer(r.to)
    audio.play('step', r.axis === 1 ? r.dir * 3 : 0)
    if (r.axis === 1) coach.yMoves += 1
  }
  if (r.collected >= 0) {
    view.collect(r.collected)
    ui.collectPulse(r.collected)
    audio.play('collect', run.collectedCount * 2)
    coach.collected += 1
  }
  coach.bumps = 0
  refresh()
  if (r.won) win()
}

const dir = (d: number) => (d > 0 ? '前方' : '后方')

function undo(): void {
  if (mode !== 'playing') return
  const before = run.pos
  const s = run.undo()
  if (!s) return
  if (s.pos[3] !== before[3]) view.setSlice(s.pos[3], s.pos[3] - before[3])
  view.movePlayer(s.pos)
  view.setCollected(run.mask)
  audio.play('undo')
  refresh()
}

function win(): void {
  mode = 'won'
  view.celebrate()
  audio.play('win')
  const stars = starsFor(run.moves, par)
  const id = level.id
  save.stars[id] = Math.max(save.stars[id] ?? 0, stars)
  save.best[id] = Math.min(save.best[id] ?? Infinity, run.moves)
  save.unlocked = Math.max(save.unlocked, levelNo + 1)
  writeSave(save)
  ui.coachSay(null)
  const moves = run.moves
  window.setTimeout(() => {
    if (mode !== 'won') return
    ui.winScreen(
      { n: levelNo, moves, par, stars, best: save.best[id], last: levelNo === CAMPAIGN_LENGTH - 1 },
      () => startLevel(levelNo + 1),
      () => startLevel(levelNo),
      openLevels,
    )
  }, 900)
}

// ── Coach (in-level tutorial) ───────────────────────────────────────────
function updateCoach(dt: number): void {
  if (mode !== 'playing') return ui.coachSay(null)
  coach.timer += dt
  const m = input.method
  const total = level.items.length
  let msg: string | null = null
  switch (level.lesson) {
    case 'move':
      if (coach.collected === 0) msg = `用 ${keyLabel(m, 'move')} 移动，收集全部 <b>${total}</b> 颗光核`
      else if (coach.collected === 1 && coach.timer < 30) msg = `视角可以旋转：${keyLabel(m, 'rotate')}。走错了？${keyLabel(m, 'undo')} 撤销`
      break
    case 'height':
      if (coach.yMoves === 0) msg = `这里有两层。用 ${keyLabel(m, 'up')} ${keyLabel(m, 'down')} 上下移动，地上的影子标出你的位置`
      else if (coach.collected < total && coach.yMoves < 3) msg = `右侧的刻度显示你在第几层；挡住你的上层方块会变成半透明`
      break
    case 'phase':
      if (coach.wMoves === 0) msg = `墙把右边的光核隔开了。按 ${keyLabel(m, 'wnext')} 沿<b>第四个方向</b>移动到下一个切片`
      else if (run.pos[3] === 1 && coach.collected === 0) msg = `你来到了「${sliceName(1)}」切片：这里没有那堵墙！走到右侧，再按 ${keyLabel(m, 'wprev')} 回到「${sliceName(0)}」`
      else if (coach.collected < total && coach.wMoves < 4) msg = `底部的<b>维度带</b>同时显示所有切片：白色菱形是你，虚线框是你在另一片的位置`
      break
    case 'ghost':
      if (coach.wMoves === 0) msg = `<b>半透明</b>的光核在别的切片里：<b>颜色</b>就是切片的颜色，<b>光环数</b>表示相隔几片`
      else if (coach.collected < 2 && coach.wMoves < 4) msg = `切换切片时墙壁会生长或消失——就像四维物体穿过三维空间`
      break
    case 'mix':
      if (coach.blockedW === 0 && coach.timer < 14) msg = `维度带中的<b class="x">✕</b>表示那个切片的同一位置有墙，切换前先看一眼`
      break
  }
  if (!msg && coach.bumps >= 4 && level.size[3] > 1) msg = `此路不通？试试 ${keyLabel(m, 'wprev')} ${keyLabel(m, 'wnext')} 切换到其他切片`
  ui.coachSay(msg)
}

// ── Menus ───────────────────────────────────────────────────────────────
function showTitle(): void {
  mode = 'title'
  document.body.classList.add('in-title')
  view.title = true
  ui.coachSay(null)
  loadLevel(Math.min(save.unlocked, CAMPAIGN_LENGTH - 1), false)
  ui.titleScreen(save.unlocked > 0, {
    play: () => {
      if (!save.seenHelp) {
        save.seenHelp = true
        writeSave(save)
      }
      startLevel(Math.min(save.unlocked, CAMPAIGN_LENGTH + 50))
    },
    levels: openLevels,
    help: () => openHelp(showTitle),
    secret: () => ui.toggleDebug(),
  })
}

function openLevels(): void {
  const prev = mode
  mode = 'menu'
  const total = Math.max(CAMPAIGN_LENGTH, save.unlocked + 1)
  ui.levelSelect(
    total,
    save.unlocked,
    n => save.stars[levelIdFor(n)] ?? 0,
    n => (n < CAMPAIGN_LENGTH ? levelAt(n).name : `无尽 ${n - CAMPAIGN_LENGTH + 1}`),
    n => startLevel(n),
    () => (prev === 'title' ? showTitle() : prev === 'won' ? startLevel(levelNo) : resume()),
  )
}

function levelIdFor(n: number): string {
  return n < CAMPAIGN_LENGTH ? levelAt(n).id : `e${n - CAMPAIGN_LENGTH + 1}`
}

function openHelp(back: () => void): void {
  const prev = mode
  mode = 'menu'
  ui.helpScreen(input.method, () => {
    if (prev === 'playing') resume()
    else back()
  })
}

function resume(): void {
  mode = 'playing'
  ui.showOverlay(null)
  refresh()
}

// ── Input wiring ────────────────────────────────────────────────────────
input.onMethod = m => {
  ui.setMethod(m)
  strip.setKeyboard(m === 'keyboard')
  updateCoach(0)
}
ui.setMethod(input.method)

input.onAction = (a: Action) => {
  audio.unlock()
  if (a.type === 'debug') return ui.toggleDebug()
  if (a.type === 'menu') {
    if (mode === 'playing') return openLevels()
    if (mode === 'menu' || mode === 'won') return ui.overlay.querySelector<HTMLButtonElement>('[data-k=back],[data-k=close],[data-k=menu]')?.click()
    return
  }
  if (a.type === 'help') {
    if (mode === 'playing') openHelp(resume)
    return
  }
  if (a.type === 'rotate') {
    view.rotateStep(a.dir)
    return
  }
  if (mode === 'title' && a.type === 'confirm') return ui.overlay.querySelector<HTMLButtonElement>('[data-k=play]')?.click()
  if (mode !== 'playing') return
  switch (a.type) {
    case 'move': {
      const g = screenToGrid(view.yawIndex, a.screen)
      return doMove(g.axis, g.dir)
    }
    case 'y':
      return doMove(1, a.dir)
    case 'w':
      return doMove(3, a.dir)
    case 'undo':
      return undo()
    case 'restart':
      return restart()
  }
}

for (const d of ['up', 'down', 'left', 'right'] as const) input.bindButton(ui.btn['d' + d], () => ({ type: 'move', screen: d }))
input.bindButton(ui.btn.yup, () => ({ type: 'y', dir: 1 }))
input.bindButton(ui.btn.ydown, () => ({ type: 'y', dir: -1 }))
input.bindButton(ui.btn.wprev, () => ({ type: 'w', dir: -1 }))
input.bindButton(ui.btn.wnext, () => ({ type: 'w', dir: 1 }))
input.bindButton(ui.btn.undo, () => ({ type: 'undo' }))
ui.btn.restart.onclick = () => restart()
ui.btn.menu.onclick = () => (mode === 'playing' ? openLevels() : undefined)
ui.btn.help.onclick = () => (mode === 'playing' ? openHelp(resume) : undefined)
ui.btn.rotL.onclick = () => view.rotateStep(-1)
ui.btn.rotR.onclick = () => view.rotateStep(1)
ui.btn.mute.onclick = () => {
  save.muted = !save.muted
  audio.setMuted(save.muted)
  ui.setMuted(save.muted)
  writeSave(save)
}
strip.onPick = w => {
  if (mode !== 'playing') return
  const d = w - run.pos[3]
  if (d === 0) return
  if (Math.abs(d) > 1) {
    ui.toast('一次只能移动到相邻的切片', 'warn')
    audio.play('bump')
    return
  }
  doMove(3, d)
}

// Debug panel
ui.btn.dbgSolve.onclick = () => {
  solutionShown = !solutionShown
  view.showSolution(solutionShown ? solve(level, run.pos, run.mask)?.path ?? null : null)
}
ui.btn.dbgStep.onclick = () => {
  if (mode !== 'playing') return
  const sol = solve(level, run.pos, run.mask)
  const next = sol?.path[1]
  if (!next) return
  const axis = [0, 1, 2, 3].find(a => next[a] !== run.pos[a])!
  doMove(axis, next[axis] - run.pos[axis])
  if (solutionShown) view.showSolution(solve(level, run.pos, run.mask)?.path ?? null)
}
ui.btn.dbgPrev.onclick = () => startLevel(Math.max(0, levelNo - 1))
ui.btn.dbgNext.onclick = () => startLevel(levelNo + 1)
ui.btn.dbgUnlock.onclick = () => {
  save.unlocked = CAMPAIGN_LENGTH - 1
  writeSave(save)
  ui.toast('已解锁全部关卡')
}
if (params.has('debug')) ui.toggleDebug(true)

audio.setMuted(save.muted)
ui.setMuted(save.muted)
window.addEventListener('resize', () => view.resize())
new ResizeObserver(() => view.resize()).observe(ui.stage)
document.addEventListener('visibilitychange', () => input.releaseAll())

// ── Frame loop ──────────────────────────────────────────────────────────
let last = performance.now()
let fps = 60
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05
  view.update(dt)
  strip.draw({ level, pos: run.pos, mask: run.mask, yawIndex: view.yawIndex })
  if (mode === 'playing') updateCoach(dt)
  ui.debug({ level, pos: run.pos, mask: run.mask, moves: run.moves, par, bumps: run.bumps, yaw: view.yawIndex, method: input.method, fps })
  requestAnimationFrame(frame)
}

const lv = params.get('level')
if (lv !== null && Number.isInteger(Number(lv))) startLevel(Math.max(0, Number(lv) - 1))
else showTitle()
requestAnimationFrame(frame)

// Test hook for automated screenshots; harmless in production.
;(window as unknown as Record<string, unknown>).__game = {
  act: (a: Action) => input.onAction(a),
  state: () => ({ mode, levelNo, pos: run.pos, mask: run.mask, moves: run.moves, par }),
}
