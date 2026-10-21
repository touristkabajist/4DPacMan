import { describe, expect, it } from 'vitest'
import { fromIndex, index, isWall, type Level, type V4 } from '../src/core/grid'
import { CAMPAIGN_LENGTH, generate, levelAt, parseAscii, tutorialCount } from '../src/core/levels'
import { Run, starsFor } from '../src/core/run'
import { distances, solve } from '../src/core/solver'

describe('grid', () => {
  it('index/fromIndex round-trip', () => {
    const size = [5, 3, 4, 2] as const
    for (let i = 0; i < 5 * 3 * 4 * 2; i += 1) expect(index(size, fromIndex(size, i))).toBe(i)
  })
  it('out of bounds counts as wall', () => {
    const lv = levelAt(0)
    expect(isWall(lv, [-1, 0, 0, 0])).toBe(true)
    expect(isWall(lv, [0, 0, 0, 1])).toBe(true)
  })
})

describe('ascii parser', () => {
  it('reads walls, start, items, heights and slices', () => {
    const lv = parseAscii({ id: 'x', name: '', subtitle: '', lesson: 'move', layers: [['S#|..', 'o.|.#'], ['..|..', '..|o.']] })
    expect(lv.size).toEqual([2, 2, 2, 2])
    expect(lv.start).toEqual([0, 0, 0, 0])
    expect(lv.items).toEqual([[0, 0, 1, 0], [0, 1, 1, 1]])
    expect(isWall(lv, [1, 0, 0, 0])).toBe(true)
    expect(isWall(lv, [1, 1, 1, 0])).toBe(true)
    expect(isWall(lv, [1, 0, 0, 1])).toBe(false)
  })
  it('rejects ragged rows', () => {
    expect(() => parseAscii({ id: 'bad', name: '', subtitle: '', lesson: 'move', layers: [['S..', '..']] })).toThrow()
  })
})

describe('solver', () => {
  it('finds the optimal collection order', () => {
    const lv = parseAscii({ id: 'line', name: '', subtitle: '', lesson: 'move', layers: [['o.S..o']] })
    // Go left 2 first then right 5 = 7 (right first would be 3 + 5 = 8).
    expect(solve(lv)!.par).toBe(7)
  })
  it('uses W to pass a wall', () => {
    const lv = parseAscii({ id: 'w', name: '', subtitle: '', lesson: 'phase', layers: [['S#o'], ['...']] })
    const sol = solve(lv)!
    expect(sol.par).toBe(4)
    expect(sol.path.some(p => p[3] === 1)).toBe(true)
  })
  it('returns null when impossible', () => {
    const lv = parseAscii({ id: 'n', name: '', subtitle: '', lesson: 'move', layers: [['S#o']] })
    expect(solve(lv)).toBeNull()
  })
  it('respects locked axes', () => {
    const lv = parseAscii({ id: 'w', name: '', subtitle: '', lesson: 'phase', layers: [['S#o'], ['...']] })
    const d = distances(lv, lv.start, [3])
    expect(d[index(lv.size, [2, 0, 0, 0])]).toBe(-1)
  })
})

describe('campaign', () => {
  const levels: Level[] = []
  for (let n = 0; n < CAMPAIGN_LENGTH + 2; n += 1) levels.push(levelAt(n))

  it.each(levels.map((l, i) => [i, l] as const))('level %i is solvable and well-formed', (_, lv) => {
    expect(isWall(lv, lv.start)).toBe(false)
    for (const it of lv.items) expect(isWall(lv, it)).toBe(false)
    const sol = solve(lv)
    expect(sol).not.toBeNull()
    expect(sol!.par).toBeGreaterThan(0)
  })

  it('tutorials 3+ require moving in W', () => {
    for (let n = 2; n < tutorialCount(); n += 1) {
      const lv = levels[n]
      const flat = distances(lv, lv.start, [3])
      expect(lv.items.some(p => flat[index(lv.size, p)] < 0)).toBe(true)
    }
  })

  it('generated levels need W and spread cores over slices', () => {
    for (let n = tutorialCount(); n < levels.length; n += 1) {
      const lv = levels[n]
      const flat = distances(lv, lv.start, [3])
      expect(lv.items.some(p => flat[index(lv.size, p)] < 0)).toBe(true)
      const ws = new Set(lv.items.map(p => p[3]))
      expect(ws.size).toBe(Math.min(lv.items.length, lv.size[3]))
    }
  })

  it('generator is deterministic', () => {
    const a = generate({ size: [5, 2, 5, 3], items: 4, density: 0.34 }, 42, { id: 'a', name: '', subtitle: '' })
    const b = generate({ size: [5, 2, 5, 3], items: 4, density: 0.34 }, 42, { id: 'a', name: '', subtitle: '' })
    expect(Array.from(a.walls)).toEqual(Array.from(b.walls))
    expect(a.items).toEqual(b.items)
  })
})

describe('run', () => {
  const lv = parseAscii({ id: 'r', name: '', subtitle: '', lesson: 'phase', layers: [['S#o'], ['...']] })

  it('blocks walls and bounds without counting a move', () => {
    const run = new Run(lv)
    expect(run.tryMove(0, 1).kind).toBe('blocked')
    const oob = run.tryMove(0, -1)
    expect(oob.kind === 'blocked' && oob.outOfBounds).toBe(true)
    expect(run.moves).toBe(0)
    expect(run.bumps).toBe(2)
  })

  it('collects, wins and stops accepting input', () => {
    const run = new Run(lv)
    const seq: [number, number][] = [[3, 1], [0, 1], [0, 1], [3, -1]]
    let last
    for (const [a, d] of seq) last = run.tryMove(a, d)
    expect(last!.kind === 'moved' && last!.collected === 0 && last!.won).toBe(true)
    expect(run.moves).toBe(4)
    expect(run.tryMove(0, -1).kind).toBe('ignored')
  })

  it('undo restores position, mask and moves', () => {
    const lv2 = parseAscii({ id: 'u', name: '', subtitle: '', lesson: 'move', layers: [['So.o']] })
    const run = new Run(lv2)
    run.tryMove(0, 1)
    expect(run.collectedCount).toBe(1)
    run.undo()
    expect(run.pos).toEqual([0, 0, 0, 0] as V4)
    expect(run.collectedCount).toBe(0)
    expect(run.moves).toBe(0)
    expect(run.undo()).toBeNull()
  })

  it('stars', () => {
    expect(starsFor(10, 10)).toBe(3)
    expect(starsFor(15, 10)).toBe(2)
    expect(starsFor(16, 10)).toBe(1)
  })
})
