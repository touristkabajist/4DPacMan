/**
 * 4D obstacles: convex polytopes (axis-aligned tesseracts and 5-cells / 4-simplices).
 *
 * Collision: the player is a ball of radius PLAYER_R (lattice units). A move from p to its neighbour q
 * is blocked when the segment p→q meets the obstacle grown by that radius. "Grown" = every facet
 * pushed out by R plus the bounding box grown by R — a slight over-approximation of the exact
 * Minkowski sum, which keeps sharp simplex corners from reaching far.
 *
 * Rendering helpers: `sliceObstacle` intersects an obstacle with a hyperplane n·x = c (the 3D slice
 * through the player, perpendicular to the hidden view direction).
 */
export type Vec4 = [number, number, number, number]

export const PLAYER_R = 0.3

export interface Plane {
  n: Vec4
  d: number
}

export interface Obstacle {
  kind: 'box' | 'simplex'
  verts: Vec4[]
  edges: [number, number][]
  /** Inside ⇔ n·x ≤ d for every plane. */
  planes: Plane[]
  min: Vec4
  max: Vec4
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
const norm = (a: ArrayLike<number>) => Math.sqrt(dot(a, a))

/** Axis-aligned 4D box, inclusive integer corners. A "tesseract" when all sides are equal. */
export function box(min: Vec4, max: Vec4): Obstacle {
  const verts: Vec4[] = []
  for (let i = 0; i < 16; i += 1) verts.push([0, 1, 2, 3].map(b => (i & (1 << b) ? max[b] : min[b])) as Vec4)
  const edges: [number, number][] = []
  for (let i = 0; i < 16; i += 1) for (let b = 0; b < 4; b += 1) {
    const j = i ^ (1 << b)
    if (j > i) edges.push([i, j])
  }
  const planes: Plane[] = []
  for (let a = 0; a < 4; a += 1) {
    const e: Vec4 = [0, 0, 0, 0]
    e[a] = 1
    planes.push({ n: e, d: max[a] })
    planes.push({ n: e.map(v => -v) as Vec4, d: -min[a] })
  }
  return { kind: 'box', verts, edges, planes, min: [...min], max: [...max] }
}

/** Tesseract centred on `c` with half-side `h` (side 2h). */
export const tesseract = (c: Vec4, h: number): Obstacle => box(c.map(v => v - h) as Vec4, c.map(v => v + h) as Vec4)

/** Normal of the hyperplane through 4 points (generalised cross product of 3 edge vectors). */
function facetNormal(a: Vec4, b: Vec4, c: Vec4, d: Vec4): Vec4 {
  const u = b.map((v, i) => v - a[i])
  const v = c.map((x, i) => x - a[i])
  const w = d.map((x, i) => x - a[i])
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const n: number[] = []
  for (let k = 0; k < 4; k += 1) {
    const cols = [0, 1, 2, 3].filter(j => j !== k)
    n.push((k % 2 ? -1 : 1) * det3([u, v, w].map(r => cols.map(j => r[j]))))
  }
  return n as Vec4
}

/** 5-cell (4-simplex): convex hull of 5 affinely independent points. */
export function simplex(verts: Vec4[]): Obstacle {
  if (verts.length !== 5) throw new Error('a 4-simplex needs 5 vertices')
  const edges: [number, number][] = []
  for (let i = 0; i < 5; i += 1) for (let j = i + 1; j < 5; j += 1) edges.push([i, j])
  const planes: Plane[] = []
  for (let i = 0; i < 5; i += 1) {
    const f = verts.filter((_, j) => j !== i)
    let n = facetNormal(f[0], f[1], f[2], f[3])
    const len = norm(n)
    if (len < 1e-9) throw new Error('degenerate simplex')
    n = n.map(v => v / len) as Vec4
    let d = dot(n, f[0])
    // Orient so the opposite vertex is inside.
    if (dot(n, verts[i]) > d) {
      n = n.map(v => -v) as Vec4
      d = -d
    }
    planes.push({ n, d })
  }
  const min = [0, 1, 2, 3].map(a => Math.min(...verts.map(v => v[a]))) as Vec4
  const max = [0, 1, 2, 3].map(a => Math.max(...verts.map(v => v[a]))) as Vec4
  return { kind: 'simplex', verts: verts.map(v => [...v] as Vec4), edges, planes, min, max }
}

/**
 * A wall perpendicular to `axis` (covering [lo, hi] on it and the whole map on the others) with a
 * rectangular hole: lattice points with every other coordinate in [holeMin, holeMax] stay free.
 * Built from 6 boxes.
 */
export function wallWithHole(axis: number, lo: number, hi: number, holeMin: Vec4, holeMax: Vec4, extent: number): Obstacle[] {
  const others = [0, 1, 2, 3].filter(a => a !== axis)
  const out: Obstacle[] = []
  const baseMin: Vec4 = [-extent, -extent, -extent, -extent]
  const baseMax: Vec4 = [extent, extent, extent, extent]
  baseMin[axis] = lo
  baseMax[axis] = hi
  const curMin = [...baseMin] as Vec4
  const curMax = [...baseMax] as Vec4
  for (const a of others) {
    if (holeMin[a] - 1 >= curMin[a]) {
      const mx = [...curMax] as Vec4
      mx[a] = holeMin[a] - 1
      out.push(box([...curMin] as Vec4, mx))
    }
    if (holeMax[a] + 1 <= curMax[a]) {
      const mn = [...curMin] as Vec4
      mn[a] = holeMax[a] + 1
      out.push(box(mn, [...curMax] as Vec4))
    }
    // Narrow to the hole on this axis and continue with the next one.
    curMin[a] = holeMin[a]
    curMax[a] = holeMax[a]
  }
  return out
}

// ── Collision ────────────────────────────────────────────────────────────
const EPS = 1e-9

/** Is point p inside the obstacle grown by r? */
export function containsPoint(o: Obstacle, p: ArrayLike<number>, r = PLAYER_R): boolean {
  for (let a = 0; a < 4; a += 1) if (p[a] < o.min[a] - r - EPS || p[a] > o.max[a] + r + EPS) return false
  for (const pl of o.planes) if (dot(pl.n, p) > pl.d + r * norm(pl.n) + EPS) return false
  return true
}

/** Does the segment p→q meet the obstacle grown by r? (Cyrus–Beck clipping.) */
export function segmentHits(o: Obstacle, p: ArrayLike<number>, q: ArrayLike<number>, r = PLAYER_R): boolean {
  let t0 = 0
  let t1 = 1
  const dir = [q[0] - p[0], q[1] - p[1], q[2] - p[2], q[3] - p[3]]
  const clip = (n: ArrayLike<number>, d: number): boolean => {
    const num = d - dot(n, p)
    const den = dot(n, dir)
    if (Math.abs(den) < EPS) return num >= -EPS
    const t = num / den
    if (den > 0) t1 = Math.min(t1, t)
    else t0 = Math.max(t0, t)
    return t0 <= t1 + EPS
  }
  for (let a = 0; a < 4; a += 1) {
    const e = [0, 0, 0, 0]
    e[a] = 1
    if (!clip(e, o.max[a] + r)) return false
    e[a] = -1
    if (!clip(e, -(o.min[a] - r))) return false
  }
  for (const pl of o.planes) if (!clip(pl.n, pl.d + r * norm(pl.n))) return false
  return true
}

// ── Slicing (rendering) ──────────────────────────────────────────────────
/**
 * Points of the obstacle's intersection with the hyperplane n·x = c: vertices on the plane plus
 * crossings of edges that straddle it. Their convex hull is the 3D slice. Empty if no intersection.
 */
export function sliceObstacle(o: Obstacle, n: ArrayLike<number>, c: number): Vec4[] {
  const s = o.verts.map(v => dot(n, v) - c)
  const out: Vec4[] = []
  const seen = new Set<string>()
  const add = (p: Vec4) => {
    const k = p.map(v => Math.round(v * 1e5)).join(',')
    if (seen.has(k)) return
    seen.add(k)
    out.push(p)
  }
  o.verts.forEach((v, i) => Math.abs(s[i]) < 1e-7 && add([...v] as Vec4))
  for (const [i, j] of o.edges) {
    if ((s[i] < -1e-7 && s[j] > 1e-7) || (s[i] > 1e-7 && s[j] < -1e-7)) {
      const t = s[i] / (s[i] - s[j])
      add(o.verts[i].map((v, k) => v + (o.verts[j][k] - v) * t) as Vec4)
    }
  }
  return out
}

// ── Curved obstacles: thickened surfaces ─────────────────────────────────
/**
 * A 2D surface in 4D thickened by `thickness`: everything within that distance of the surface is
 * solid. A surface alone has codimension 2 (it can't wall anything off in 4D), so thickness and
 * combinations with other obstacles are what make these hard.
 */
export interface Surface {
  kind: 'klein'
  thickness: number
  /** Distance from p to the surface (not counting thickness). May return any value > cutoff early. */
  dist(p: ArrayLike<number>, cutoff?: number): number
  /** Dense surface samples (≈0.35 apart) — used to draw the 3D slice. */
  samples: Vec4[]
  /** Wireframe of parameter lines (segment endpoint pairs) — the "ghost". */
  ghost: Vec4[]
  min: Vec4
  max: Vec4
}

export type Shape = Obstacle | Surface
export const isSurface = (s: Shape): s is Surface => s.kind === 'klein'

/** 4×4 row-major orthonormal matrix applied to a vector. */
const mulM = (m: ArrayLike<number> | null, v: ArrayLike<number>): Vec4 =>
  m
    ? ([0, 1, 2, 3].map(r => m[r * 4] * v[0] + m[r * 4 + 1] * v[1] + m[r * 4 + 2] * v[2] + m[r * 4 + 3] * v[3]) as Vec4)
    : ([v[0], v[1], v[2], v[3]] as Vec4)
const mulMT = (m: ArrayLike<number> | null, v: ArrayLike<number>): Vec4 =>
  m
    ? ([0, 1, 2, 3].map(c => m[c] * v[0] + m[4 + c] * v[1] + m[8 + c] * v[2] + m[12 + c] * v[3]) as Vec4)
    : ([v[0], v[1], v[2], v[3]] as Vec4)

/** Klein bottle point in local coordinates (the standard self-intersection-free embedding in R⁴). */
export function kleinPoint(R: number, r: number, u: number, v: number): Vec4 {
  return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v) * Math.cos(u / 2), r * Math.sin(v) * Math.sin(u / 2)]
}

const KU = 72
const KCOS = Float64Array.from({ length: KU }, (_, i) => Math.cos((2 * Math.PI * i) / KU))
const KSIN = Float64Array.from({ length: KU }, (_, i) => Math.sin((2 * Math.PI * i) / KU))
const KCH = Float64Array.from({ length: KU }, (_, i) => Math.cos((Math.PI * i) / KU))
const KSH = Float64Array.from({ length: KU }, (_, i) => Math.sin((Math.PI * i) / KU))

/**
 * Distance from local point (x, y, z, w) to the Klein bottle. For fixed u the surface is a circle of
 * radius r around R·(cos u, sin u, 0, 0) in the plane spanned by (cos u, sin u, 0, 0) and
 * (0, 0, cos u/2, sin u/2); distance to that circle is closed-form, then we minimise over u.
 */
export function kleinDistLocal(R: number, r: number, x: number, y: number, z: number, w: number, cutoff = Infinity): number {
  // Lower bound: the surface lies within r of the core circle.
  const rho = Math.hypot(x, y)
  const lb = Math.hypot(rho - R, z, w) - r
  if (lb > cutoff) return lb
  const n2 = x * x + y * y + z * z + w * w
  const at = (cu: number, su: number, ch: number, sh: number) => {
    const a = x * cu + y * su - R
    const b = z * ch + w * sh
    const d2 = n2 - 2 * R * (x * cu + y * su) + R * R
    const q2 = Math.max(0, d2 - a * a - b * b)
    const t = Math.sqrt(a * a + b * b) - r
    return t * t + q2
  }
  let best = Infinity
  let bi = 0
  for (let i = 0; i < KU; i += 1) {
    const d = at(KCOS[i], KSIN[i], KCH[i], KSH[i])
    if (d < best) {
      best = d
      bi = i
    }
  }
  // Golden-section refinement around the best sample.
  const step = (2 * Math.PI) / KU
  let lo = bi * step - step
  let hi = bi * step + step
  const f = (u: number) => at(Math.cos(u), Math.sin(u), Math.cos(u / 2), Math.sin(u / 2))
  const g = 0.618033988749895
  let c = hi - g * (hi - lo)
  let d = lo + g * (hi - lo)
  let fc = f(c)
  let fd = f(d)
  for (let k = 0; k < 14; k += 1) {
    if (fc < fd) {
      hi = d; d = c; fd = fc; c = hi - g * (hi - lo); fc = f(c)
    } else {
      lo = c; c = d; fc = fd; d = lo + g * (hi - lo); fd = f(d)
    }
  }
  return Math.sqrt(Math.min(best, fc, fd))
}

/**
 * Klein bottle obstacle: major radius R, tube radius r, thickened by `thickness`, centred at `c`,
 * optionally rotated by an orthonormal 4×4 matrix `rot` (row-major, local → world).
 */
export function klein(c: Vec4, R: number, r: number, thickness: number, rot: ArrayLike<number> | null = null): Surface {
  const toWorld = (p: Vec4) => mulM(rot, p).map((v, i) => v + c[i]) as Vec4
  const samples: Vec4[] = []
  const nu = Math.ceil((2 * Math.PI * (R + r)) / 0.35)
  const nv = Math.ceil((2 * Math.PI * r) / 0.35)
  for (let i = 0; i < nu; i += 1) for (let j = 0; j < nv; j += 1) samples.push(toWorld(kleinPoint(R, r, (2 * Math.PI * i) / nu, (2 * Math.PI * j) / nv)))
  const ghost: Vec4[] = []
  const line = (pts: Vec4[]) => {
    for (let k = 1; k < pts.length; k += 1) ghost.push(pts[k - 1], pts[k])
  }
  // u-lines (closed circles) and v-lines (open: after a full turn in u they come back as −v).
  for (let i = 0; i < 18; i += 1) {
    const u = (2 * Math.PI * i) / 18
    line(Array.from({ length: 25 }, (_, k) => toWorld(kleinPoint(R, r, u, (2 * Math.PI * k) / 24))))
  }
  for (let j = 0; j < 8; j += 1) {
    const v = (2 * Math.PI * j) / 8
    line(Array.from({ length: 73 }, (_, k) => toWorld(kleinPoint(R, r, (2 * Math.PI * k) / 72, v))))
  }
  const min = [0, 1, 2, 3].map(a => Math.min(...samples.map(p => p[a])) - thickness) as Vec4
  const max = [0, 1, 2, 3].map(a => Math.max(...samples.map(p => p[a])) + thickness) as Vec4
  return {
    kind: 'klein',
    thickness,
    dist(p, cutoff = Infinity) {
      const l = mulMT(rot, [p[0] - c[0], p[1] - c[1], p[2] - c[2], p[3] - c[3]])
      return kleinDistLocal(R, r, l[0], l[1], l[2], l[3], cutoff)
    },
    samples,
    ghost,
    min,
    max,
  }
}
