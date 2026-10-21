import { describe, expect, it } from 'vitest'
import { Grid, UNREACHABLE } from '../src/grid'
import { box, containsPoint, segmentHits, simplex, sliceObstacle, tesseract, wallWithHole, type Vec4 } from '../src/obstacles'
import { manhattan, Round, type V4 } from '../src/space'

describe('obstacles', () => {
  it('tesseract: contains / segment tests with player radius', () => {
    const t = tesseract([0, 0, 0, 0], 1)
    expect(containsPoint(t, [0, 0, 0, 0])).toBe(true)
    expect(containsPoint(t, [1, 1, 1, 1])).toBe(true)
    expect(containsPoint(t, [2, 0, 0, 0])).toBe(false)
    // Moving into the face is blocked; moving alongside it one step away is free.
    expect(segmentHits(t, [2, 0, 0, 0], [1, 0, 0, 0])).toBe(true)
    expect(segmentHits(t, [3, 0, 0, 0], [2, 0, 0, 0])).toBe(false)
    expect(segmentHits(t, [2, 2, 0, 0], [2, 1, 0, 0])).toBe(false)
  })

  it('simplex facets enclose its vertices and centroid', () => {
    const v: Vec4[] = [[0, 0, 0, 0], [4, 0, 0, 0], [0, 4, 0, 0], [0, 0, 4, 0], [0, 0, 0, 4]]
    const s = simplex(v)
    expect(s.planes).toHaveLength(5)
    const c = [0.8, 0.8, 0.8, 0.8]
    expect(containsPoint(s, c, 0)).toBe(true)
    for (const p of v) expect(containsPoint(s, p, 0)).toBe(true)
    expect(containsPoint(s, [3, 3, 0, 0], 0)).toBe(false)
    expect(containsPoint(s, [-1, 0, 0, 0], 0)).toBe(false)
  })

  it('slice of a tesseract through its centre is a 3D cube (8 points)', () => {
    const t = tesseract([0, 0, 0, 0], 2)
    expect(sliceObstacle(t, [0, 0, 0, 1], 0)).toHaveLength(8)
    expect(sliceObstacle(t, [0, 0, 0, 1], 5)).toHaveLength(0)
    // Slice of a 5-cell is a tetrahedron or triangular prism-like shape (4–6 points).
    const s = simplex([[0, 0, 0, 0], [4, 0, 0, 0], [0, 4, 0, 0], [0, 0, 4, 0], [0, 0, 0, 4]])
    const n = sliceObstacle(s, [0, 0, 0, 1], 1).length
    expect(n).toBe(4)
  })
})

describe('grid', () => {
  it('blocked edges are symmetric and the path detours around a tesseract', () => {
    const g = new Grid(5, [tesseract([0, 0, 0, 0], 1)])
    expect(g.isBlocked([3, 0, 0, 0], 0, -1)).toBe(false)
    expect(g.isBlocked([2, 0, 0, 0], 0, -1)).toBe(true)
    expect(g.isBlocked([1, 0, 0, 0], 0, 1)).toBe(true)
    expect(g.solid[g.index([0, 0, 0, 0])]).toBe(1)
    const field = g.distances([-3, 0, 0, 0])
    const d = field[g.index([3, 0, 0, 0])]
    expect(d).toBeGreaterThan(6) // straight line is 6; must go round
    expect(d).toBe(10) // up 2, across 6, down 2
    const path = g.descend(field, [3, 0, 0, 0])
    expect(path).toHaveLength(d + 1)
    expect(path[path.length - 1]).toEqual([-3, 0, 0, 0])
    for (let i = 1; i < path.length; i += 1) expect(manhattan(path[i - 1], path[i])).toBe(1)
  })

  it('wall with a hole only passable through the hole', () => {
    const ex = 4
    const walls = wallWithHole(0, 0, 0, [0, 2, 2, 2], [0, 2, 2, 2], ex)
    const g = new Grid(ex, walls)
    const f = g.distances([-2, 0, 0, 0])
    // Must go through (0, 2, 2, 2): |−2→0| + 2+2+2 + |0→2| + 6 back = 2+6+2+6 = 16.
    expect(f[g.index([2, 0, 0, 0])]).toBe(16)
    const solidWall = new Grid(ex, [box([0, -ex, -ex, -ex], [0, ex, ex, ex])])
    expect(solidWall.distances([-2, 0, 0, 0])[solidWall.index([2, 0, 0, 0])]).toBe(UNREACHABLE)
  })
})

describe('round with obstacles', () => {
  it('blocks moves, uses true distances, and places targets reachable & outside obstacles', () => {
    const start: V4 = [-4, 0, 0, 0]
    const r = new Round(7, 4, start, { extent: 6, obstacles: [tesseract([0, 0, 0, 0], 2)] })
    for (const t of r.targets) {
      expect(r.grid!.solid[r.grid!.index(t)]).toBe(0)
      expect(r.distTo(0, start)).toBeLessThan(Infinity)
    }
    for (let i = 0; i < 1; i += 1) r.tryMove(0, 1)
    expect(r.pos).toEqual([-3, 0, 0, 0])
    const res = r.tryMove(0, 1)
    expect(res.kind).toBe('blocked')
    expect(r.pos).toEqual([-3, 0, 0, 0])
    expect(r.moves).toBe(1)
    expect(r.blockedMask() & (1 << 1)).toBeTruthy()
    // Optimal ≥ Manhattan lower bound.
    expect(r.optimal).toBeGreaterThanOrEqual(r.targets.reduce((a, t) => Math.max(a, manhattan(start, t)), 0))
  })

  it('following the guide path always wins with exactly the greedy route', () => {
    const r = new Round(11, 3, [-4, 0, 0, 0], { extent: 6, obstacles: [tesseract([0, 0, 0, 0], 2), tesseract([0, 4, 0, 4], 1)] })
    for (let guard = 0; guard < 500 && !r.won; guard += 1) {
      const p = r.guidePath()
      const a = [0, 1, 2, 3].find(k => p[1][k] !== r.pos[k])!
      const res = r.tryMove(a, Math.sign(p[1][a] - r.pos[a]))
      expect(res.kind).toBe('moved')
    }
    expect(r.won).toBe(true)
  })
})
