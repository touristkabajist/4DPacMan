import type { SliceView } from './render/scene'

export type Screen = 'up' | 'down' | 'left' | 'right'
export type Action =
  | { type: 'move'; screen: Screen }
  | { type: 'y'; dir: number }
  | { type: 'w'; dir: number }
  | { type: 'undo' }
  | { type: 'restart' }
  | { type: 'rotate'; dir: number }
  | { type: 'debug' }
  | { type: 'menu' }
  | { type: 'confirm' }
  | { type: 'help' }

export type Method = 'keyboard' | 'touch'

const KEYS: Record<string, Action> = {
  KeyW: { type: 'move', screen: 'up' },
  ArrowUp: { type: 'move', screen: 'up' },
  KeyS: { type: 'move', screen: 'down' },
  ArrowDown: { type: 'move', screen: 'down' },
  KeyA: { type: 'move', screen: 'left' },
  ArrowLeft: { type: 'move', screen: 'left' },
  KeyD: { type: 'move', screen: 'right' },
  ArrowRight: { type: 'move', screen: 'right' },
  KeyR: { type: 'y', dir: 1 },
  Space: { type: 'y', dir: 1 },
  KeyF: { type: 'y', dir: -1 },
  KeyC: { type: 'y', dir: -1 },
  KeyQ: { type: 'w', dir: -1 },
  KeyE: { type: 'w', dir: 1 },
  KeyZ: { type: 'undo' },
  Backspace: { type: 'undo' },
  KeyT: { type: 'restart' },
  Comma: { type: 'rotate', dir: -1 },
  Period: { type: 'rotate', dir: 1 },
  Backquote: { type: 'debug' },
  Escape: { type: 'menu' },
  Enter: { type: 'confirm' },
  KeyH: { type: 'help' },
}

/** Actions that can auto-repeat when a key/button is held. */
const REPEATABLE = new Set(['move', 'y', 'w', 'undo'])
const REPEAT_DELAY = 260
const REPEAT_RATE = 125

/**
 * Turns keyboard, mouse and touch into discrete game actions.
 *  - Keyboard: WASD/arrows (screen-relative), R/F or Space/C (height), Q/E (4th dimension).
 *  - Touch: on-screen pad (wired by the UI through `press`), swipe on the scene to move,
 *    two-finger drag to orbit, pinch to zoom.
 *  - Mouse: drag to orbit, wheel to zoom.
 */
export class Input {
  method: Method = 'keyboard'
  onAction: (a: Action) => void = () => {}
  onMethod: (m: Method) => void = () => {}
  private held = new Map<string, number>()

  constructor(private readonly canvas: HTMLCanvasElement, private readonly view: SliceView) {
    window.addEventListener('keydown', this.keydown)
    window.addEventListener('keyup', e => this.release('k:' + e.code))
    window.addEventListener('blur', () => this.releaseAll())
    window.addEventListener('pointerdown', e => this.setMethod(e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : this.method), { capture: true })
    if (matchMedia('(pointer: coarse)').matches) this.method = 'touch'
    this.bindCanvas()
  }

  private setMethod(m: Method): void {
    if (m === this.method) return
    this.method = m
    this.onMethod(m)
  }

  private keydown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return
    const a = KEYS[e.code]
    if (!a) return
    // Let Enter/Space activate a focused button normally.
    if ((e.code === 'Enter' || e.code === 'Space') && target?.tagName === 'BUTTON') return
    e.preventDefault()
    this.setMethod('keyboard')
    if (e.repeat) return
    if (e.metaKey || e.ctrlKey) return
    this.press('k:' + e.code, a)
  }

  /** Fire an action and start auto-repeat for movement until `release(id)`. */
  press(id: string, a: Action): void {
    this.release(id)
    this.onAction(a)
    if (!REPEATABLE.has(a.type)) return
    const start = window.setTimeout(() => {
      const iv = window.setInterval(() => this.onAction(a), REPEAT_RATE)
      this.held.set(id, iv)
    }, REPEAT_DELAY)
    this.held.set(id, start)
  }

  release(id: string): void {
    const t = this.held.get(id)
    if (t === undefined) return
    window.clearTimeout(t)
    window.clearInterval(t)
    this.held.delete(id)
  }

  releaseAll(): void {
    for (const id of [...this.held.keys()]) this.release(id)
  }

  /** Wire an on-screen button so press-and-hold repeats. */
  bindButton(el: HTMLElement, a: () => Action | null): void {
    const id = 'b:' + Math.random().toString(36).slice(2)
    el.addEventListener('pointerdown', e => {
      e.preventDefault()
      const act = a()
      if (!act) return
      el.setPointerCapture?.(e.pointerId)
      el.classList.add('pressed')
      this.press(id, act)
    })
    const up = () => {
      el.classList.remove('pressed')
      this.release(id)
    }
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('lostpointercapture', up)
    el.addEventListener('contextmenu', e => e.preventDefault())
  }

  private bindCanvas(): void {
    const c = this.canvas
    const pts = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>()
    let pinch = 0
    let mouseDrag = false
    let multi = false

    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId)
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() })
      if (e.pointerType === 'mouse') {
        mouseDrag = true
        this.view.dragging = true
      }
      if (pts.size === 2) {
        multi = true
        this.view.dragging = true
        const [a, b] = [...pts.values()]
        pinch = Math.hypot(a.x - b.x, a.y - b.y)
      }
    })
    c.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId)
      if (!p) return
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      p.x = e.clientX
      p.y = e.clientY
      if (mouseDrag) {
        this.view.dragYaw(-dx * 0.008, dy * 0.006)
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch > 0) this.view.zoomBy(pinch / d)
        pinch = d
        this.view.dragYaw(-dx * 0.006 / 2, dy * 0.004 / 2)
      }
    })
    const end = (e: PointerEvent) => {
      const p = pts.get(e.pointerId)
      pts.delete(e.pointerId)
      if (mouseDrag) {
        mouseDrag = false
        this.view.dragging = false
        this.view.endDrag()
        return
      }
      if (multi) {
        if (pts.size === 0) {
          multi = false
          this.view.dragging = false
          this.view.endDrag()
        }
        return
      }
      if (!p || e.type === 'pointercancel') return
      // Single-finger flick on the scene = one step in that screen direction.
      const dx = e.clientX - p.sx
      const dy = e.clientY - p.sy
      const dt = performance.now() - p.t
      if (Math.hypot(dx, dy) > 28 && dt < 600) {
        const screen: Screen = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
        this.onAction({ type: 'move', screen })
      }
    }
    c.addEventListener('pointerup', end)
    c.addEventListener('pointercancel', end)
    c.addEventListener('wheel', e => {
      e.preventDefault()
      this.view.zoomBy(Math.exp(e.deltaY * 0.0012))
    }, { passive: false })
    c.addEventListener('contextmenu', e => e.preventDefault())
  }
}
