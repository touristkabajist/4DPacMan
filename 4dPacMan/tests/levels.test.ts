import { describe, expect, it } from 'vitest'
import { CHAPTERS, LEVELS, currentLevel, isUnlocked, loadProgress, recordFinish, saveProgress, stars } from '../src/levels'
import { MAX_EXTENT, inBounds, manhattan, optimalTour, Round } from '../src/space'

describe('levels', () => {
  it('ids are unique and every chapter has levels', () => {
    expect(new Set(LEVELS.map(l => l.id)).size).toBe(LEVELS.length)
    for (const c of CHAPTERS) expect(LEVELS.some(l => l.chapter === c.id)).toBe(true)
  })

  it('every ready level generates a valid, deterministic layout within its limits', () => {
    for (const l of LEVELS.filter(l => l.ready)) {
      const a = new Round(l.seed, l.targets, l.start, l.opts)
      const b = new Round(l.seed, l.targets, l.start, l.opts)
      expect(a.targets).toEqual(b.targets)
      expect(a.targets).toHaveLength(l.targets)
      for (const t of a.targets) {
        expect(inBounds(t, a.extent)).toBe(true)
        const d = manhattan(t, l.start)
        if (l.opts.minFromStart !== undefined) expect(d).toBeGreaterThanOrEqual(l.opts.minFromStart)
        if (l.opts.maxFromStart !== undefined) expect(d).toBeLessThanOrEqual(l.opts.maxFromStart)
      }
    }
  }, 30000)

  it('map size never shrinks along the level list and never exceeds ±MAX_EXTENT', () => {
    const ex = LEVELS.map(l => l.opts.extent ?? 0)
    for (const e of ex) expect(e).toBeGreaterThan(0)
    for (const e of ex) expect(e).toBeLessThanOrEqual(MAX_EXTENT)
    for (let i = 1; i < ex.length; i += 1) if (LEVELS[i].chapter === LEVELS[i - 1].chapter) expect(ex[i]).toBeGreaterThanOrEqual(ex[i - 1])
    expect(Math.max(...ex)).toBe(MAX_EXTENT)
  })

  it('difficulty (optimal moves) grows through chapter 1', () => {
    const opt = LEVELS.filter(l => l.chapter === 1).map(l => new Round(l.seed, l.targets, l.start, l.opts).optimal)
    for (let i = 1; i < opt.length; i += 1) expect(opt[i]).toBeGreaterThan(opt[i - 1])
  })

  it('stars', () => {
    expect(stars(20, 20)).toBe(3)
    expect(stars(24, 20)).toBe(2)
    expect(stars(25, 20)).toBe(1)
    expect(stars(12, 10)).toBe(2) // at least 2 moves of slack
  })

  it('unlock flow: sequential, not-ready levels stay locked', () => {
    const p = { best: {} as Record<string, number> }
    expect(isUnlocked(p, '1-1')).toBe(true)
    expect(isUnlocked(p, '1-2')).toBe(false)
    expect(currentLevel(p).id).toBe('1-1')
    recordFinish(p, '1-1', 30)
    expect(isUnlocked(p, '1-2')).toBe(true)
    expect(currentLevel(p).id).toBe('1-2')
    for (const l of LEVELS.filter(l => l.chapter === 1)) recordFinish(p, l.id, 1)
    expect(isUnlocked(p, '2-1')).toBe(true)
    expect(currentLevel(p).id).toBe('2-1')
    expect(isUnlocked(p, '3-1')).toBe(false)
    expect(isUnlocked(p, '3-1', true)).toBe(true)
    for (const l of LEVELS.filter(l => l.ready)) recordFinish(p, l.id, 1)
    expect(currentLevel(p).id).toBe(LEVELS.filter(l => l.ready).pop()!.id)
  })

  it('obstacle levels: obstacles really force detours, everything reachable', () => {
    for (const l of LEVELS.filter(l => l.ready && l.opts.obstacles?.length)) {
      const r = new Round(l.seed, l.targets, l.start, l.opts)
      expect(r.optimal, l.id).toBeLessThan(Infinity)
      const free = new Round(l.seed, l.targets, l.start, { ...l.opts, obstacles: [] })
      // Same targets would give the Manhattan tour; with obstacles it must be strictly longer.
      const manhattanTour = optimalTour(l.start, r.targets)
      // Open block fields and codimension-2 Klein surfaces can still allow an obstacle-free staircase;
      // walls/single blockers must not.
      if (l.id === '2-3' || CHAPTERS[l.chapter - 1].kind === 'klein') expect(r.optimal, l.id).toBeGreaterThanOrEqual(manhattanTour)
      else expect(r.optimal, l.id).toBeGreaterThan(manhattanTour)
      // Walking each target straight (X, then Y, Z, W) must run into an obstacle somewhere.
      const naive = new Round(l.seed, l.targets, l.start, l.opts)
      let bumped = false
      for (const t of naive.targets) for (let a = 0; a < 4 && !bumped; a += 1) {
        while (naive.pos[a] !== t[a]) {
          const res = naive.tryMove(a, Math.sign(t[a] - naive.pos[a]))
          if (res.kind === 'blocked') { bumped = true; break }
        }
      }
      expect(bumped, l.id).toBe(true)
      expect(free.extent).toBe(r.extent)
    }
  }, 30000)

  it('records only improvements and survives storage round-trip / corruption', () => {
    const p = { best: {} as Record<string, number> }
    expect(recordFinish(p, '1-1', 30)).toBe(true)
    expect(recordFinish(p, '1-1', 31)).toBe(false)
    expect(recordFinish(p, '1-1', 28)).toBe(true)
    const m = new Map<string, string>()
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
    saveProgress(store, p)
    expect(loadProgress(store)).toEqual({ best: { '1-1': 28 } })
    m.set([...m.keys()][0], '{not json')
    expect(loadProgress(store)).toEqual({ best: {} })
    expect(loadProgress(undefined)).toEqual({ best: {} })
  })
})
