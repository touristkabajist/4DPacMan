import { describe, expect, it } from 'vitest'
import { Grid, UNREACHABLE } from '../src/grid'
import { PLAYER_R, klein, kleinDistLocal, kleinPoint } from '../src/obstacles'
import { axisRotation } from '../src/rot4'

describe('klein bottle', () => {
  it('distance: 0 on the surface, R−r at the centre, never above the sample distance', () => {
    const R = 6
    const r = 2.5
    for (let i = 0; i < 40; i += 1) {
      const p = kleinPoint(R, r, i * 0.37, i * 0.91)
      expect(kleinDistLocal(R, r, ...p)).toBeLessThan(1e-3)
    }
    expect(kleinDistLocal(R, r, 0, 0, 0, 0)).toBeCloseTo(R - r, 3)
    const k = klein([0, 0, 0, 0], R, r, 1)
    for (const q of [[1, 2, 3, 0.5], [7, -1, 2, 2], [-3, 5, -1, 1.5]]) {
      const brute = Math.min(...k.samples.map(s => Math.hypot(...s.map((v, i) => v - q[i]))))
      const d = k.dist(q)
      expect(d).toBeLessThanOrEqual(brute + 1e-6)
      expect(d).toBeGreaterThan(brute - 0.3) // samples ~0.35 apart
    }
  })

  it('placement and rotation move the surface', () => {
    const k = klein([2, 0, 0, 1], 5, 2, 1, axisRotation(0, 3, Math.PI / 2))
    for (const s of k.samples.slice(0, 50)) expect(k.dist(s)).toBeLessThan(0.05)
  })

  it('grid: thick Klein bottle blocks moves near it but space stays connected', () => {
    const k = klein([0, 0, 0, 0], 5, 2, 1)
    const g = new Grid(8, [k])
    // A surface point is solid; the centre is free.
    const sp = kleinPoint(5, 2, 0, 0).map(Math.round)
    expect(g.solid[g.index(sp)]).toBe(1)
    expect(g.solid[g.index([0, 0, 0, 0])]).toBe(0)
    // Every free node is reachable from the centre (a 2D surface can't separate 4D space)…
    const f = g.distances([0, 0, 0, 0])
    let free = 0
    let cut = 0
    for (let i = 0; i < g.count; i += 1) if (!g.solid[i]) { free += 1; if (f[i] === UNREACHABLE) cut += 1 }
    expect(cut / free).toBeLessThan(0.01)
    // …but going straight out along X must detour.
    expect(f[g.index([8, 0, 0, 0])]).toBeGreaterThan(8)
    // Blocked edges stay ≥ T away from nothing: each blocked edge has a point within T of the surface.
    const T = 1 + PLAYER_R
    expect(g.isBlocked([2, 0, 0, 0], 0, 1)).toBe(k.dist([3, 0, 0, 0]) < T || k.dist([2.5, 0, 0, 0]) < T || k.dist([2, 0, 0, 0]) < T)
  })
})
