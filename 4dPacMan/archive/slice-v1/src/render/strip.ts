import { index, type Level, type V4 } from '../core/grid'
import { basis } from './basis'
import { sliceHex, sliceName, wallColor } from './palette'

type Card = { root: HTMLButtonElement; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; badge: HTMLElement; flash: number }

export type StripState = { level: Level; pos: V4; mask: number; yawIndex: number }

/**
 * The dimension strip: one top-down minimap per W slice, side by side like pages of a book.
 * It shows every slice at once — where cores are, where the walls are — and where *you* would
 * land in each slice (your "shadow"), red-crossed if a wall is there. Minimaps rotate with the
 * camera so they always read the same way as the main view. Tap an adjacent slice to phase.
 */
export class DimStrip {
  readonly el: HTMLElement
  private cards: Card[] = []
  private level?: Level
  onPick: (w: number) => void = () => {}

  constructor(host: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'strip'
    this.el.setAttribute('role', 'group')
    this.el.setAttribute('aria-label', '维度切片')
    host.appendChild(this.el)
  }

  build(level: Level, keyboard: boolean): void {
    this.level = level
    this.el.innerHTML = ''
    this.cards = []
    const nw = level.size[3]
    this.el.classList.toggle('single', nw === 1)
    for (let w = 0; w < nw; w += 1) {
      const root = document.createElement('button')
      root.className = 'slice-card'
      root.style.setProperty('--hue', sliceHex(w))
      root.setAttribute('aria-label', `${sliceName(w)} 切片`)
      root.innerHTML = `<canvas></canvas><span class="slice-name">${sliceName(w)}</span><span class="slice-badge"></span>`
      const canvas = root.querySelector('canvas')!
      const badge = root.querySelector<HTMLElement>('.slice-badge')!
      root.addEventListener('click', () => this.onPick(w))
      this.el.appendChild(root)
      this.cards.push({ root, canvas, ctx: canvas.getContext('2d')!, badge, flash: 0 })
    }
    this.setKeyboard(keyboard)
  }

  private keyboard = true
  setKeyboard(on: boolean): void {
    this.keyboard = on
  }

  flashBlocked(w: number): void {
    const c = this.cards[w]
    if (!c) return
    c.root.classList.remove('blocked')
    void c.root.offsetWidth
    c.root.classList.add('blocked')
  }

  draw(s: StripState): void {
    if (!this.level || s.level !== this.level) return
    const [nx, ny, nz, nw] = s.level.size
    const b = basis(s.yawIndex)
    const odd = s.yawIndex % 2 === 1
    const cols = odd ? nz : nx
    const rows = odd ? nx : nz
    const cx = (nx - 1) / 2
    const cz = (nz - 1) / 2
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    for (let w = 0; w < nw; w += 1) {
      const card = this.cards[w]
      const here = w === s.pos[3]
      const adj = Math.abs(w - s.pos[3]) === 1
      card.root.classList.toggle('current', here)
      card.root.classList.toggle('adjacent', adj)
      card.badge.textContent = adj && this.keyboard ? (w < s.pos[3] ? 'Q' : 'E') : adj ? (w < s.pos[3] ? '◀' : '▶') : ''
      const cw = card.canvas.clientWidth
      const ch = card.canvas.clientHeight
      if (!cw || !ch) continue
      if (card.canvas.width !== Math.round(cw * dpr) || card.canvas.height !== Math.round(ch * dpr)) {
        card.canvas.width = Math.round(cw * dpr)
        card.canvas.height = Math.round(ch * dpr)
      }
      const g = card.ctx
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, cw, ch)
      const cell = Math.min((cw - 6) / cols, (ch - 6) / rows)
      const ox = (cw - cell * cols) / 2
      const oy = (ch - cell * rows) / 2
      const toScreen = (x: number, z: number): [number, number] => {
        const dx = x - cx
        const dz = z - cz
        const u = dx * b.right[0] + dz * b.right[1]
        const v = -(dx * b.forward[0] + dz * b.forward[1])
        return [ox + (u + (cols - 1) / 2) * cell, oy + (v + (rows - 1) / 2) * cell]
      }
      const wc = '#' + wallColor(w).getHexString()
      const y = s.pos[1]
      g.fillStyle = 'rgba(255,255,255,0.05)'
      g.fillRect(ox, oy, cell * cols, cell * rows)
      for (let z = 0; z < nz; z += 1) for (let x = 0; x < nx; x += 1) {
        const [sx, sy] = toScreen(x, z)
        if (s.level.walls[index(s.level.size, [x, y, z, w])]) {
          g.fillStyle = wc
          g.fillRect(sx - cell / 2 + 0.5, sy - cell / 2 + 0.5, cell - 1, cell - 1)
        } else if (ny > 1) {
          // Faint hint of walls on other heights in this column.
          let other = 0
          for (let yy = 0; yy < ny; yy += 1) if (yy !== y && s.level.walls[index(s.level.size, [x, yy, z, w])]) other += 1
          if (other) {
            g.fillStyle = 'rgba(255,255,255,' + 0.08 * other + ')'
            g.fillRect(sx - cell / 2 + 0.5, sy - cell / 2 + 0.5, cell - 1, cell - 1)
          }
        }
      }
      // Cores in this slice.
      s.level.items.forEach((it, i) => {
        if (it[3] !== w || (s.mask & (1 << i))) return
        const [sx, sy] = toScreen(it[0], it[2])
        g.beginPath()
        g.arc(sx, sy, cell * 0.28, 0, Math.PI * 2)
        if (it[1] === y) {
          g.fillStyle = sliceHex(w)
          g.shadowColor = sliceHex(w)
          g.shadowBlur = 6
          g.fill()
          g.shadowBlur = 0
        } else {
          g.strokeStyle = sliceHex(w)
          g.lineWidth = 1.5
          g.stroke()
          // Tiny arrow: core is above or below your height.
          g.beginPath()
          const up = it[1] > y
          g.moveTo(sx - cell * 0.12, sy + (up ? -0.38 : 0.38) * cell)
          g.lineTo(sx + cell * 0.12, sy + (up ? -0.38 : 0.38) * cell)
          g.lineTo(sx, sy + (up ? -0.52 : 0.52) * cell)
          g.closePath()
          g.fillStyle = sliceHex(w)
          g.fill()
        }
      })
      // You (in the current slice) or your shadow (where you would land in other slices).
      const [px, py] = toScreen(s.pos[0], s.pos[2])
      const blocked = !here && s.level.walls[index(s.level.size, [s.pos[0], s.pos[1], s.pos[2], w])] === 1
      g.lineWidth = 2
      if (here) {
        g.fillStyle = '#ffffff'
        g.shadowColor = '#ffffff'
        g.shadowBlur = 8
        g.beginPath()
        g.moveTo(px, py - cell * 0.38)
        g.lineTo(px + cell * 0.38, py)
        g.lineTo(px, py + cell * 0.38)
        g.lineTo(px - cell * 0.38, py)
        g.closePath()
        g.fill()
        g.shadowBlur = 0
      } else if (blocked) {
        g.strokeStyle = '#ff4d6d'
        g.beginPath()
        g.moveTo(px - cell * 0.32, py - cell * 0.32)
        g.lineTo(px + cell * 0.32, py + cell * 0.32)
        g.moveTo(px + cell * 0.32, py - cell * 0.32)
        g.lineTo(px - cell * 0.32, py + cell * 0.32)
        g.stroke()
      } else {
        g.strokeStyle = 'rgba(255,255,255,0.85)'
        g.setLineDash([2, 2])
        g.strokeRect(px - cell * 0.34, py - cell * 0.34, cell * 0.68, cell * 0.68)
        g.setLineDash([])
      }
      card.root.classList.toggle('shadow-blocked', blocked && adj)
    }
  }
}
