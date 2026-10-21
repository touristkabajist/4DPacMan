/**
 * 4×4 rotations for the 4D → 3D view. A view matrix M (row-major, orthonormal) maps a world point p
 * to view space v = M·p; (v0, v1, v2) is drawn in 3D and v3 ("w′") is the hidden depth.
 * Rotating the 4D view = left-multiplying M by a rotation in a view-space plane.
 */
export type Mat4 = Float64Array

export function identity(): Mat4 {
  const m = new Float64Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

export function mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16)
  for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) {
    let s = 0
    for (let k = 0; k < 4; k += 1) s += a[r * 4 + k] * b[k * 4 + c]
    out[r * 4 + c] = s
  }
  return out
}

export function apply(m: Mat4, p: ArrayLike<number>, out: number[] = [0, 0, 0, 0]): number[] {
  for (let r = 0; r < 4; r += 1) out[r] = m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3] * p[3]
  return out
}

/** Rotation by `angle` in the plane spanned by orthonormal u, v (u turns toward v). */
export function planeRotation(u: ArrayLike<number>, v: ArrayLike<number>, angle: number): Mat4 {
  const m = identity()
  const s = Math.sin(angle)
  const c1 = Math.cos(angle) - 1
  for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) {
    m[r * 4 + k] += s * (v[r] * u[k] - u[r] * v[k]) + c1 * (u[r] * u[k] + v[r] * v[k])
  }
  return m
}

const E = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
]

/** Rotation in the plane of two basis axes (i → j). */
export function axisRotation(i: number, j: number, angle: number): Mat4 {
  return planeRotation(E[i], E[j], angle)
}

/** Gram–Schmidt on rows, keeping M a proper rotation despite float drift or interpolation. */
export function orthonormalize(m: Mat4): Mat4 {
  const out = new Float64Array(m)
  for (let r = 0; r < 4; r += 1) {
    for (let q = 0; q < r; q += 1) {
      let d = 0
      for (let k = 0; k < 4; k += 1) d += out[r * 4 + k] * out[q * 4 + k]
      for (let k = 0; k < 4; k += 1) out[r * 4 + k] -= d * out[q * 4 + k]
    }
    let n = 0
    for (let k = 0; k < 4; k += 1) n += out[r * 4 + k] ** 2
    n = Math.sqrt(n) || 1
    for (let k = 0; k < 4; k += 1) out[r * 4 + k] /= n
  }
  return out
}

export function lerpRotation(a: Mat4, b: Mat4, t: number): Mat4 {
  const out = new Float64Array(16)
  for (let i = 0; i < 16; i += 1) out[i] = a[i] + (b[i] - a[i]) * t
  return orthonormalize(out)
}

export function determinant(m: Mat4): number {
  const a = (r: number, c: number) => m[r * 4 + c]
  let det = 0
  for (let c = 0; c < 4; c += 1) {
    const minor: number[] = []
    for (let r = 1; r < 4; r += 1) for (let k = 0; k < 4; k += 1) if (k !== c) minor.push(a(r, k))
    const d3 = minor[0] * (minor[4] * minor[8] - minor[5] * minor[7]) - minor[1] * (minor[3] * minor[8] - minor[5] * minor[6]) + minor[2] * (minor[3] * minor[7] - minor[4] * minor[6])
    det += (c % 2 ? -1 : 1) * a(0, c) * d3
  }
  return det
}

/**
 * View presets. `hide` puts that axis along w′ (pure 3D view of the other three); `oblique` is the
 * default: W tilted into view so all four axes are visible at once.
 */
export type Preset = 'oblique' | 'hideW' | 'hideZ' | 'hideY' | 'hideX'

export function preset(p: Preset): Mat4 {
  const rows = (order: number[]) => {
    const m = new Float64Array(16)
    order.forEach((axis, r) => (m[r * 4 + axis] = 1))
    // Keep it a proper rotation (det +1) by flipping the invisible w′ row if needed.
    if (determinant(m) < 0) for (let k = 0; k < 4; k += 1) m[12 + k] = -m[12 + k]
    return m
  }
  switch (p) {
    case 'hideW': return rows([0, 1, 2, 3])
    case 'hideZ': return rows([0, 1, 3, 2])
    case 'hideY': return rows([0, 3, 2, 1])
    case 'hideX': return rows([3, 1, 2, 0])
    case 'oblique': {
      // Tilt w′ into x′, z′ and y′ so all four axes are well separated on screen from the
      // default camera (angles found by a small search maximising the minimum on-screen separation).
      const m = mul(axisRotation(3, 1, -0.7), mul(axisRotation(3, 2, -0.25), mul(axisRotation(3, 0, 0.4), identity())))
      return orthonormalize(m)
    }
  }
}
