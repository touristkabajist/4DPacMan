import { describe, expect, it } from 'vitest'
import { apply, axisRotation, determinant, identity, lerpRotation, mul, orthonormalize, planeRotation, preset, type Mat4 } from '../src/rot4'
import { MAX_EXTENT, euclid4, inBounds, manhattan, optimalTour, randomTargets, Round, rng, type V4 } from '../src/space'

const isRotation = (m: Mat4) => {
  const t = mul(m, transpose(m))
  for (let i = 0; i < 16; i += 1) expect(t[i]).toBeCloseTo(i % 5 === 0 ? 1 : 0, 9)
  expect(determinant(m)).toBeCloseTo(1, 9)
}
const transpose = (m: Mat4) => {
  const o = new Float64Array(16)
  for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) o[c * 4 + r] = m[r * 4 + c]
  return o
}

describe('rot4', () => {
  it('plane rotation turns u toward v', () => {
    const m = axisRotation(0, 3, Math.PI / 2)
    const v = apply(m, [1, 0, 0, 0])
    expect(v[3]).toBeCloseTo(1)
    expect(v[0]).toBeCloseTo(0)
    isRotation(m)
  })
  it('arbitrary plane rotations stay orthonormal', () => {
    const r = Math.SQRT1_2
    const m = mul(planeRotation([r, r, 0, 0], [0, 0, 0, 1], 0.7), planeRotation([0, 0, 1, 0], [0, 0, 0, 1], -1.1))
    isRotation(m)
  })
  it('presets are proper rotations and hide the named axis', () => {
    for (const p of ['oblique', 'hideW', 'hideZ', 'hideY', 'hideX'] as const) isRotation(preset(p))
    const axes = { hideX: 0, hideY: 1, hideZ: 2, hideW: 3 } as const
    for (const [p, axis] of Object.entries(axes)) {
      const e = [0, 0, 0, 0]
      e[axis] = 1
      const v = apply(preset(p as keyof typeof axes), e)
      expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(0)
    }
  })
  it('oblique view shows every axis', () => {
    for (let a = 0; a < 4; a += 1) {
      const e = [0, 0, 0, 0]
      e[a] = 1
      const v = apply(preset('oblique'), e)
      expect(Math.hypot(v[0], v[1], v[2])).toBeGreaterThan(0.3)
    }
  })
  it('interpolation and re-orthonormalisation keep a rotation', () => {
    isRotation(lerpRotation(preset('oblique'), preset('hideZ'), 0.37))
    const drift = new Float64Array(identity())
    drift[1] = 0.01
    isRotation(orthonormalize(drift))
  })
})

describe('space', () => {
  it('4D straight-line distance uses all four axes', () => {
    expect(euclid4([0, 0, 0, 0], [1, 2, 2, 4])).toBe(5)
    expect(euclid4([3, -1, 0, 2], [3, -1, 0, 2])).toBe(0)
    expect(euclid4([0, 0, 0, 0], [0, 0, 0, -7])).toBe(7)
    expect(euclid4([1, 1, 1, 1], [0, 0, 0, 0])).toBe(2)
  })

  it('targets are valid, distinct, off the start W', () => {
    for (let seed = 1; seed < 40; seed += 1) {
      const start: V4 = [0, 0, 0, 0]
      const extent = 3 + (seed % 22)
      const ts = randomTargets(6, rng(seed), start, { extent })
      expect(ts).toHaveLength(6)
      for (const t of ts) {
        expect(inBounds(t, extent)).toBe(true)
        expect(t[3]).not.toBe(0)
        expect(manhattan(t, start)).toBeGreaterThanOrEqual(3)
      }
      for (let i = 0; i < ts.length; i += 1) for (let j = i + 1; j < ts.length; j += 1) expect(manhattan(ts[i], ts[j])).toBeGreaterThanOrEqual(2)
    }
  })
  it('optimal tour picks the best order', () => {
    // Line along X: left 2 then right to 3 = 2 + 5 = 7 (right first = 3 + 5 = 8).
    expect(optimalTour([0, 0, 0, 0], [[-2, 0, 0, 0], [3, 0, 0, 0]])).toBe(7)
    expect(optimalTour([0, 0, 0, 0], [[1, 1, 1, 1]])).toBe(4)
  })
  it('round extent is per round and capped at MAX_EXTENT', () => {
    expect(new Round(1, 2, [0, 0, 0, 0], { extent: 5 }).extent).toBe(5)
    expect(new Round(1, 2, [0, 0, 0, 0], { extent: 99 }).extent).toBe(MAX_EXTENT)
    const r = new Round(1, 1, [0, 0, 0, 0], { extent: 4 })
    for (let i = 0; i < 4; i += 1) expect(r.tryMove(0, 1).kind).not.toBe('edge')
    expect(r.tryMove(0, 1).kind).toBe('edge')
  })

  it('round: moves, edges, collection, win', () => {
    const r = new Round(7, 1)
    const t = r.targets[0]
    for (let a = 0; a < 4; a += 1) while (r.pos[a] !== t[a]) {
      const res = r.tryMove(a, Math.sign(t[a] - r.pos[a]))
      expect(res.kind).toBe('moved')
    }
    expect(r.won).toBe(true)
    expect(r.moves).toBe(r.optimal)
    expect(r.tryMove(0, 1).kind).toBe('ignored')
  })
  it('round: cannot leave the space', () => {
    const r = new Round(3, 2)
    for (let i = 0; i < r.extent; i += 1) r.tryMove(3, -1)
    const res = r.tryMove(3, -1)
    expect(res.kind).toBe('edge')
    expect(r.pos[3]).toBe(-r.extent)
  })
})
