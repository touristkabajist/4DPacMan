/**
 * Step 1 game logic: an obstacle-free bounded 4D lattice with scattered targets.
 * Coordinates are integers in [-extent, extent] on every axis (X, Y, Z, W); the extent is per round
 * (per level), at most MAX_EXTENT.
 */
import { Grid, UNREACHABLE } from './grid'
import type { Shape } from './obstacles'

export type V4 = [number, number, number, number]

/** Largest map half-size (−24…24, 49 lattice points per axis). */
export const MAX_EXTENT = 24
/** Map half-size for free play. */
export const FREE_EXTENT = 12
export const AXIS_NAMES = ['X', 'Y', 'Z', 'W'] as const

export function manhattan(a: V4, b: V4): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3])
}

/** Straight-line 4D distance: √(Δx² + Δy² + Δz² + Δw²). */
export function euclid4(a: V4, b: V4): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3])
}

export function same(a: V4, b: V4): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}

export function inBounds(p: V4, extent: number): boolean {
  return p.every(v => v >= -extent && v <= extent)
}

/** Mulberry32, so a round can be reproduced from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface TargetOpts {
  extent?: number
  /** Minimum moves from the start (default scales with the map). */
  minFromStart?: number
  /** Maximum moves from the start, so early levels stay short. */
  maxFromStart?: number
  /** Minimum moves between any two targets. */
  minApart?: number
  /** Extra placement rule (e.g. "on the far side of the wall"). */
  where?: (p: V4) => boolean
}

/**
 * Random targets: distinct, between `minFromStart` and `maxFromStart` moves from the start, `minApart`
 * from each other, and every target is off the start's W (so the 4th axis is always needed).
 */
export function randomTargets(count: number, rand: () => number, start: V4, opts: TargetOpts = {}): V4[] {
  const extent = Math.min(MAX_EXTENT, opts.extent ?? FREE_EXTENT)
  const minFromStart = opts.minFromStart ?? Math.max(3, Math.round(extent / 2))
  const maxFromStart = opts.maxFromStart ?? Infinity
  const minApart = opts.minApart ?? Math.max(2, Math.round(extent / 3))
  const out: V4[] = []
  // When the start-distance window is narrow, sample offsets from the start instead of the whole box.
  const reach = Math.min(extent, Number.isFinite(maxFromStart) ? maxFromStart : extent)
  const coord = (c: number) => {
    const lo = Math.max(-extent, c - reach)
    const hi = Math.min(extent, c + reach)
    return lo + Math.floor(rand() * (hi - lo + 1))
  }
  for (let guard = 0; out.length < count && guard < 20000; guard += 1) {
    const p: V4 = [coord(start[0]), coord(start[1]), coord(start[2]), coord(start[3])]
    if (p[3] === start[3]) continue
    const d = manhattan(p, start)
    if (d < minFromStart || d > maxFromStart) continue
    if (out.some(q => manhattan(p, q) < minApart)) continue
    if (opts.where && !opts.where(p)) continue
    out.push(p)
  }
  if (out.length < count) {
    // Narrow placement rules: enumerate every valid point, then pick in a seeded random order.
    const ok = (p: V4) => p[3] !== start[3] && manhattan(p, start) >= minFromStart && manhattan(p, start) <= maxFromStart && (!opts.where || opts.where(p))
    const pool: V4[] = []
    const p: V4 = [0, 0, 0, 0]
    for (p[0] = -extent; p[0] <= extent; p[0] += 1)
      for (p[1] = -extent; p[1] <= extent; p[1] += 1)
        for (p[2] = -extent; p[2] <= extent; p[2] += 1)
          for (p[3] = -extent; p[3] <= extent; p[3] += 1) if (ok(p)) pool.push([...p] as V4)
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    for (const c of pool) {
      if (out.length >= count) break
      if (!out.some(q => manhattan(c, q) < minApart)) out.push(c)
    }
  }
  if (out.length < count) throw new Error('could not place targets')
  return out
}

/**
 * Minimal moves to visit every target in any order. Bitmask DP over a distance function where
 * index −1 is the start (default: Manhattan, i.e. no obstacles). Infinity if some target is unreachable.
 */
export function optimalTour(start: V4, targets: V4[], distFn?: (i: number, j: number) => number): number {
  const n = targets.length
  if (n === 0) return 0
  const P = (i: number) => (i < 0 ? start : targets[i])
  const dist = distFn ?? ((i: number, j: number) => manhattan(P(i), P(j)))
  const full = (1 << n) - 1
  const dp = new Array<number>((1 << n) * n).fill(Infinity)
  for (let i = 0; i < n; i += 1) dp[(1 << i) * n + i] = dist(-1, i)
  for (let mask = 1; mask <= full; mask += 1) {
    for (let i = 0; i < n; i += 1) {
      const cur = dp[mask * n + i]
      if (!(mask & (1 << i)) || cur === Infinity) continue
      for (let j = 0; j < n; j += 1) {
        if (mask & (1 << j)) continue
        const nm = mask | (1 << j)
        const v = cur + dist(i, j)
        if (v < dp[nm * n + j]) dp[nm * n + j] = v
      }
    }
  }
  let best = Infinity
  for (let i = 0; i < n; i += 1) best = Math.min(best, dp[full * n + i])
  return best
}

/** Drop the interior points of straight runs, keeping start, corners and end. */
export function corners(path: V4[]): V4[] {
  if (path.length <= 2) return path
  const axisOf = (a: V4, b: V4) => [0, 1, 2, 3].find(k => a[k] !== b[k])!
  const out: V4[] = [path[0]]
  for (let i = 1; i < path.length - 1; i += 1) {
    if (axisOf(path[i - 1], path[i]) !== axisOf(path[i], path[i + 1])) out.push(path[i])
  }
  out.push(path[path.length - 1])
  return out
}

export type MoveResult =
  | { kind: 'moved'; from: V4; to: V4; collected: number; won: boolean }
  | { kind: 'edge'; axis: number; dir: number }
  | { kind: 'blocked'; axis: number; dir: number; obstacle: number }
  | { kind: 'ignored' }

export interface RoundOpts extends TargetOpts {
  obstacles?: Shape[]
}

export class Round {
  pos: V4
  readonly targets: V4[]
  readonly collected: boolean[]
  readonly optimal: number
  readonly extent: number
  readonly obstacles: Shape[]
  /** Navigation grid; null when there are no obstacles (Manhattan metric applies). */
  readonly grid: Grid | null
  /** BFS distance field from each target (only with obstacles). */
  private readonly fields: Uint16Array[] = []
  moves = 0
  won = false

  constructor(readonly seed: number, readonly count = 5, readonly start: V4 = [0, 0, 0, 0], opts: RoundOpts = {}) {
    this.extent = Math.min(MAX_EXTENT, opts.extent ?? FREE_EXTENT)
    this.pos = [...start] as V4
    this.obstacles = opts.obstacles ?? []
    this.grid = this.obstacles.length ? new Grid(this.extent, this.obstacles) : null
    const grid = this.grid
    let accept = opts.where
    if (grid) {
      if (grid.solid[grid.index(start)]) throw new Error('start is inside an obstacle')
      const fromStart = grid.distances(start)
      const where = opts.where
      accept = p => !grid.solid[grid.index(p)] && fromStart[grid.index(p)] !== UNREACHABLE && (!where || where(p))
    }
    this.targets = randomTargets(count, rng(seed), start, { ...opts, extent: this.extent, where: accept })
    this.collected = this.targets.map(() => false)
    if (grid) {
      for (const t of this.targets) this.fields.push(grid.distances(t))
      const P = (i: number) => (i < 0 ? start : this.targets[i])
      this.optimal = optimalTour(start, this.targets, (i, j) => this.fields[j][grid.index(P(i))])
    } else {
      this.optimal = optimalTour(start, this.targets)
    }
  }

  get remaining(): number {
    return this.collected.filter(c => !c).length
  }

  /** Moves from p to target i (true distance around obstacles). */
  distTo(i: number, p: V4 = this.pos): number {
    if (!this.grid) return manhattan(p, this.targets[i])
    const d = this.fields[i][this.grid.index(p)]
    return d === UNREACHABLE ? Infinity : d
  }

  /** Index of the closest uncollected target, or -1. */
  nearest(): number {
    let best = -1
    let bestD = Infinity
    this.targets.forEach((_, i) => {
      if (this.collected[i]) return
      const d = this.distTo(i)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }

  /** Corner points of a shortest route from the player to target i (axis order X→W without obstacles). */
  guidePath(i = this.nearest()): V4[] {
    if (i < 0) return []
    const t = this.targets[i]
    if (this.grid) return corners(this.grid.descend(this.fields[i], this.pos))
    const out: V4[] = [[...this.pos] as V4]
    const cur = [...this.pos] as V4
    for (let a = 0; a < 4; a += 1) {
      if (cur[a] === t[a]) continue
      cur[a] = t[a]
      out.push([...cur] as V4)
    }
    return out
  }

  /** Bits (axis*2 + (dir>0)) of directions the player cannot move in right now. */
  blockedMask(): number {
    if (this.grid) return this.grid.blockedMask(this.pos)
    let m = 0
    for (let a = 0; a < 4; a += 1) {
      if (this.pos[a] <= -this.extent) m |= 1 << (a * 2)
      if (this.pos[a] >= this.extent) m |= 1 << (a * 2 + 1)
    }
    return m
  }

  tryMove(axis: number, dir: number): MoveResult {
    if (this.won) return { kind: 'ignored' }
    const to = [...this.pos] as V4
    to[axis] += dir
    if (!inBounds(to, this.extent)) return { kind: 'edge', axis, dir }
    if (this.grid?.isBlocked(this.pos, axis, dir)) return { kind: 'blocked', axis, dir, obstacle: this.grid.blocker(this.pos, axis, dir) }
    const from = this.pos
    this.pos = to
    this.moves += 1
    let collected = -1
    this.targets.forEach((t, i) => {
      if (!this.collected[i] && same(t, to)) {
        this.collected[i] = true
        collected = i
      }
    })
    this.won = this.remaining === 0
    return { kind: 'moved', from, to, collected, won: this.won }
  }
}
