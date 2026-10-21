/**
 * Lattice navigation with obstacles: per-node blocked-direction bits, solid nodes, BFS distance
 * fields and shortest paths. Built once per round (only the nodes near each obstacle are tested).
 */
import { PLAYER_R, containsPoint, isSurface, segmentHits, type Shape, type Surface } from './obstacles'
import type { V4 } from './space'

export const UNREACHABLE = 0xffff

export class Grid {
  readonly size: number
  readonly count: number
  /** Bit (axis*2 + (dir>0)) set ⇔ moving that way from the node is blocked by an obstacle. */
  readonly blocked: Uint8Array
  /** Node lies inside a (grown) obstacle. */
  readonly solid: Uint8Array
  private readonly stride: number[]

  constructor(readonly extent: number, readonly obstacles: Shape[]) {
    const S = (this.size = 2 * extent + 1)
    this.count = S ** 4
    this.stride = [S ** 3, S ** 2, S, 1]
    this.blocked = new Uint8Array(this.count)
    this.solid = new Uint8Array(this.count)
    const p = [0, 0, 0, 0]
    const q = [0, 0, 0, 0]
    obstacles.forEach(o => {
      if (isSurface(o)) return this.rasterSurface(o)
      const lo = o.min.map(v => Math.max(-extent, Math.floor(v - PLAYER_R) - 1))
      const hi = o.max.map(v => Math.min(extent, Math.ceil(v + PLAYER_R) + 1))
      for (p[0] = lo[0]; p[0] <= hi[0]; p[0] += 1)
        for (p[1] = lo[1]; p[1] <= hi[1]; p[1] += 1)
          for (p[2] = lo[2]; p[2] <= hi[2]; p[2] += 1)
            for (p[3] = lo[3]; p[3] <= hi[3]; p[3] += 1) {
              const i = this.index(p)
              if (containsPoint(o, p)) this.solid[i] = 1
              // Test the + edge on each axis; mark both ends (the edge is blocked both ways).
              for (let a = 0; a < 4; a += 1) {
                if (p[a] >= extent) continue
                q[0] = p[0]; q[1] = p[1]; q[2] = p[2]; q[3] = p[3]
                q[a] += 1
                if (segmentHits(o, p, q)) {
                  this.blocked[i] |= 1 << (a * 2 + 1)
                  this.blocked[i + this.stride[a]] |= 1 << (a * 2)
                }
              }
            }
    })
  }

  /**
   * Thickened surface: a move is blocked when the ball's path comes within thickness + PLAYER_R of the
   * surface. Checked at both ends and (when needed) the midpoint — distance is 1-Lipschitz, so the
   * midpoint only matters when both ends are within T + 0.5.
   */
  private rasterSurface(o: Surface): void {
    const E = this.extent
    const T = o.thickness + PLAYER_R
    const lo = o.min.map(v => Math.max(-E, Math.floor(v - PLAYER_R) - 1))
    const hi = o.max.map(v => Math.min(E, Math.ceil(v + PLAYER_R) + 1))
    const dim = lo.map((l, a) => hi[a] - l + 1)
    const ls = [dim[1] * dim[2] * dim[3], dim[2] * dim[3], dim[3], 1]
    const D = new Float32Array(dim[0] * dim[1] * dim[2] * dim[3])
    const p = [0, 0, 0, 0]
    let k = 0
    for (p[0] = lo[0]; p[0] <= hi[0]; p[0] += 1)
      for (p[1] = lo[1]; p[1] <= hi[1]; p[1] += 1)
        for (p[2] = lo[2]; p[2] <= hi[2]; p[2] += 1)
          for (p[3] = lo[3]; p[3] <= hi[3]; p[3] += 1) {
            const d = o.dist(p, T + 0.6)
            D[k++] = d
            if (d < T) this.solid[this.index(p)] = 1
          }
    const m = [0, 0, 0, 0]
    k = 0
    for (p[0] = lo[0]; p[0] <= hi[0]; p[0] += 1)
      for (p[1] = lo[1]; p[1] <= hi[1]; p[1] += 1)
        for (p[2] = lo[2]; p[2] <= hi[2]; p[2] += 1)
          for (p[3] = lo[3]; p[3] <= hi[3]; p[3] += 1, k += 1) {
            const dp = D[k]
            if (dp >= T + 0.5) continue
            for (let a = 0; a < 4; a += 1) {
              if (p[a] >= hi[a]) continue
              const dq = D[k + ls[a]]
              let hit = dp < T || dq < T
              if (!hit && dq < T + 0.5) {
                m[0] = p[0]; m[1] = p[1]; m[2] = p[2]; m[3] = p[3]
                m[a] += 0.5
                hit = o.dist(m, T + 0.1) < T
              }
              if (hit) {
                const i = this.index(p)
                this.blocked[i] |= 1 << (a * 2 + 1)
                this.blocked[i + this.stride[a]] |= 1 << (a * 2)
              }
            }
          }
  }

  index(p: ArrayLike<number>): number {
    const E = this.extent
    return (p[0] + E) * this.stride[0] + (p[1] + E) * this.stride[1] + (p[2] + E) * this.stride[2] + (p[3] + E)
  }

  point(i: number): V4 {
    const S = this.size
    const E = this.extent
    return [Math.floor(i / this.stride[0]) - E, (Math.floor(i / this.stride[1]) % S) - E, (Math.floor(i / S) % S) - E, (i % S) - E]
  }

  inBounds(p: ArrayLike<number>): boolean {
    for (let a = 0; a < 4; a += 1) if (p[a] < -this.extent || p[a] > this.extent) return false
    return true
  }

  isBlocked(p: ArrayLike<number>, axis: number, dir: number): boolean {
    return (this.blocked[this.index(p)] & (1 << (axis * 2 + (dir > 0 ? 1 : 0)))) !== 0
  }

  /** Bits of the 8 directions that are blocked (by obstacles or the map boundary). */
  blockedMask(p: ArrayLike<number>): number {
    let m = this.blocked[this.index(p)]
    for (let a = 0; a < 4; a += 1) {
      if (p[a] <= -this.extent) m |= 1 << (a * 2)
      if (p[a] >= this.extent) m |= 1 << (a * 2 + 1)
    }
    return m
  }

  /** Index of the obstacle that blocks p→p+dir·e_axis, or -1. */
  blocker(p: ArrayLike<number>, axis: number, dir: number): number {
    const q = [p[0], p[1], p[2], p[3]]
    q[axis] += dir
    const m = [p[0], p[1], p[2], p[3]]
    m[axis] += dir / 2
    return this.obstacles.findIndex(o => {
      if (!isSurface(o)) return segmentHits(o, p, q)
      const T = o.thickness + PLAYER_R
      return o.dist(p) < T || o.dist(q) < T || o.dist(m) < T
    })
  }

  /** BFS distances (in moves) from `src` to every node; UNREACHABLE where cut off. */
  distances(src: V4): Uint16Array {
    const dist = new Uint16Array(this.count).fill(UNREACHABLE)
    const queue = new Int32Array(this.count)
    const s = this.index(src)
    dist[s] = 0
    let head = 0
    let tail = 0
    queue[tail++] = s
    const S = this.size
    while (head < tail) {
      const i = queue[head++]
      const d = dist[i] + 1
      const b = this.blocked[i]
      // Decode coordinates once per node for the boundary checks.
      let r = i
      const c3 = r % S; r = (r - c3) / S
      const c2 = r % S; r = (r - c2) / S
      const c1 = r % S
      const c0 = (r - c1) / S
      const cs = [c0, c1, c2, c3]
      for (let a = 0; a < 4; a += 1) {
        const st = this.stride[a]
        if (cs[a] > 0 && !(b & (1 << (a * 2)))) {
          const j = i - st
          if (dist[j] === UNREACHABLE) { dist[j] = d; queue[tail++] = j }
        }
        if (cs[a] < S - 1 && !(b & (1 << (a * 2 + 1)))) {
          const j = i + st
          if (dist[j] === UNREACHABLE) { dist[j] = d; queue[tail++] = j }
        }
      }
    }
    return dist
  }

  /**
   * Shortest path from `from` down a distance field (built from the destination). Prefers to keep
   * going along the current axis so the path has few corners. Returns lattice points incl. both ends.
   */
  descend(field: Uint16Array, from: V4): V4[] {
    const path: V4[] = [[...from] as V4]
    let cur = [...from] as V4
    let d = field[this.index(cur)]
    if (d === UNREACHABLE) return path
    let lastAxis = -1
    let lastDir = 0
    while (d > 0) {
      let moved = false
      const order = lastAxis >= 0 ? [[lastAxis, lastDir], ...[0, 1, 2, 3].flatMap(a => [[a, 1], [a, -1]])] : [0, 1, 2, 3].flatMap(a => [[a, 1], [a, -1]])
      for (const [a, dir] of order) {
        const nx = [...cur] as V4
        nx[a] += dir
        if (!this.inBounds(nx) || this.isBlocked(cur, a, dir)) continue
        if (field[this.index(nx)] === d - 1) {
          cur = nx
          d -= 1
          lastAxis = a
          lastDir = dir
          path.push(cur)
          moved = true
          break
        }
      }
      if (!moved) break
    }
    return path
  }
}
