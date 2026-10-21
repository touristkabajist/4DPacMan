/**
 * Levels: chapters grouped by obstacle kind, each with a fixed list of seeded levels.
 * Chapter 3 uses thickened Klein bottles (curved 2D surfaces in 4D) combined with polytopes.
 */
import { axisRotation, mul } from './rot4'
import { klein, simplex, tesseract, wallWithHole, type Obstacle, type Vec4 } from './obstacles'
import { Round, type RoundOpts, type V4 } from './space'

export type ObstacleKind = 'none' | 'polytope' | 'klein'

export interface Chapter {
  id: number
  name: string
  kind: ObstacleKind
  blurb: string
}

export interface Level {
  /** "chapter-index", e.g. "1-3". */
  id: string
  chapter: number
  name: string
  /** One-line goal shown when the level starts. */
  brief: string
  targets: number
  seed: number
  start: V4
  opts: RoundOpts
  /** False until the chapter's obstacle type exists. */
  ready: boolean
}

export const CHAPTERS: Chapter[] = [
  { id: 1, name: '自由空间', kind: 'none', blurb: '没有障碍，熟悉四个方向与第四维视角。' },
  { id: 2, name: '四维方块', kind: 'polytope', blurb: '超立方体与五胞体（四维三角）挡在路上——它们在你所在的切面里显示为三维形状。' },
  { id: 3, name: '克莱因瓶', kind: 'klein', blurb: '弯曲的四维曲面挡在路上，内外难辨。' },
]

const O: V4 = [0, 0, 0, 0]
const lv = (chapter: number, i: number, name: string, brief: string, targets: number, seed: number, opts: RoundOpts, ready = true, start: V4 = O): Level => ({
  id: `${chapter}-${i}`,
  chapter,
  name,
  brief,
  targets,
  seed,
  start,
  opts,
  ready,
})

export const LEVELS: Level[] = [
  // Chapter 1 — maps grow from 9 to 33 points per axis; more targets, wider spread.
  lv(1, 1, '第一步', '走到唯一的目标那里。', 1, 101, { extent: 4, minFromStart: 5, maxFromStart: 9, minApart: 2 }),
  lv(1, 2, '三颗星', '收集 3 个目标，顺序由你决定。', 3, 202, { extent: 6, minFromStart: 4, minApart: 4 }),
  lv(1, 3, '规划顺序', '5 个目标——先想好路线再出发。', 5, 303, { extent: 8, minApart: 4 }),
  lv(1, 4, '远征', '目标散布在更大的空间里。', 6, 404, { extent: 12 }),
  lv(1, 5, '四维巡游', '8 个目标，挑战最短路线。', 8, 505, { extent: 16 }),
  // Chapter 2 — convex 4D obstacles: tesseracts and 5-cells.
  lv(2, 1, '第一块方块', '一个超立方体挡在 X 方向，绕过去。', 2, 1201, {
    extent: 7,
    obstacles: [tesseract([3, 0, 0, 0], 2)],
    where: p => p[0] >= 6 && Math.abs(p[1]) <= 2 && Math.abs(p[2]) <= 2 && Math.abs(p[3]) <= 2,
    minApart: 2,
  }),
  lv(2, 2, '四维三角', '五胞体是四维的"三角形"，它的切面是三角形的立体：四面体或三棱柱。', 3, 1202, {
    extent: 10,
    obstacles: [regular5Cell([5, 0, 0, 0.6], 6.5)],
    where: p => p[0] >= 10 && Math.abs(p[1]) <= 1 && Math.abs(p[2]) <= 1 && p[3] >= 1 && p[3] <= 2,
    minApart: 2,
  }),
  lv(2, 3, '方块阵', '80 个超立方体排成四维方阵，沿缝隙穿行。', 4, 1203, {
    extent: 10,
    obstacles: blockField(),
    minApart: 5,
  }),
  lv(2, 4, '藏在第四维', '一堵 W 方向的墙，只有一个洞能穿过。', 4, 1204, {
    extent: 12,
    obstacles: [...wallWithHole(3, 3, 4, [6, 6, -7, 0], [7, 7, -6, 0], 12), tesseract([-6, 0, 0, 0], 2)],
    where: p => p[3] >= 6,
    minApart: 6,
  }),
  lv(2, 5, '迷宫', '两道墙、几块方块和五胞体组成的四维迷宫。', 6, 1205, {
    extent: 14,
    obstacles: [
      ...wallWithHole(0, 4, 5, [0, -10, 9, 9], [0, -9, 10, 10], 14),
      ...wallWithHole(0, -5, -4, [0, 9, -10, -10], [0, 10, -9, -9], 14),
      tesseract([10, 0, 0, 0], 3),
      tesseract([-10, 4, 4, 4], 3),
      regular5Cell([0, 8, -6, 6], 4),
      regular5Cell([0, -8, 6, -6], 4),
    ],
    minApart: 6,
  }),
  // Chapter 3 — curved Klein-bottle obstacles; the final level uses the full ±24 map.
  lv(3, 1, '曲面', '一个加厚的克莱因瓶环绕着你，绕开它弯曲的管壁。', 3, 1301, {
    extent: 16,
    obstacles: [klein([0, 0, 0, 0], 8, 3, 1.2)],
    where: p => Math.hypot(p[0], p[1]) >= 13,
    minApart: 8,
  }),
  lv(3, 2, '无内无外', '你从瓶管内部出发：目标有的在管内，有的在管外。', 4, 1302, {
    extent: 20,
    obstacles: [klein([0, 0, 0, 0], 9, 3.5, 1.2), tesseract([0, 0, 0, 12], 3)],
    where: p => coreDist(p, 9) < 1.6 || Math.hypot(p[0], p[1]) >= 16,
    minFromStart: 12,
    minApart: 10,
  }, true, [9, 0, 0, 0]),
  lv(3, 3, '穿瓶而过', '最终关卡：两个交错的克莱因瓶、一堵 W 墙和散落的方块。', 5, 1303, {
    extent: 24,
    obstacles: [
      klein([-9, 0, 0, 0], 10, 3.5, 1.3, axisRotation(1, 3, Math.PI / 3)),
      klein([10, 4, 0, -4], 7, 3, 1.3, mul(axisRotation(0, 2, Math.PI / 2), axisRotation(2, 3, 0.5))),
      ...wallWithHole(3, 15, 16, [-20, -20, 18, 0], [-18, -18, 20, 0], 24),
      tesseract([0, 14, 0, 0], 3),
      tesseract([0, -14, 6, 6], 3),
      regular5Cell([14, -12, -8, 6], 5),
    ],
    where: p => Math.max(...p.map(Math.abs)) >= 12,
    minApart: 12,
  }),
]

/** Distance from p to the core circle (radius R in the X–Y plane) of an unrotated, centred Klein bottle. */
function coreDist(p: V4, R: number): number {
  return Math.hypot(Math.hypot(p[0], p[1]) - R, p[2], p[3])
}

/** Regular 5-cell (4-simplex) with circumradius ≈ r around `c`. */
function regular5Cell(c: Vec4, r: number): Obstacle {
  const k = r / Math.sqrt(3.2)
  const base: Vec4[] = [
    [1, 1, 1, -1 / Math.sqrt(5)],
    [1, -1, -1, -1 / Math.sqrt(5)],
    [-1, 1, -1, -1 / Math.sqrt(5)],
    [-1, -1, 1, -1 / Math.sqrt(5)],
    [0, 0, 0, 4 / Math.sqrt(5)],
  ]
  return simplex(base.map(v => v.map((x, i) => c[i] + x * k) as Vec4))
}

/**
 * A 4D grid of tesseracts (side 4) on centres {−6, 0, 6}⁴, minus the centre (the start). The free
 * space is a lattice of 1-wide corridors at coordinates ±3 and ±9.
 */
function blockField(): Obstacle[] {
  const out: Obstacle[] = []
  const C = [-6, 0, 6]
  for (const x of C) for (const y of C) for (const z of C) for (const w of C) {
    if (!x && !y && !z && !w) continue
    out.push(tesseract([x, y, z, w], 2))
  }
  return out
}

/** Optimal move count per level (computing it builds the obstacle grid, so cache it). */
const optCache = new Map<string, number>()
export function levelOptimal(l: Level): number {
  let v = optCache.get(l.id)
  if (v === undefined) {
    v = new Round(l.seed, l.targets, l.start, l.opts).optimal
    optCache.set(l.id, v)
  }
  return v
}

export const levelById = (id: string): Level | undefined => LEVELS.find(l => l.id === id)

export function nextLevel(id: string): Level | undefined {
  const i = LEVELS.findIndex(l => l.id === id)
  return i >= 0 ? LEVELS[i + 1] : undefined
}

/** 3 stars = optimal route, 2 = within 20 % (at least 2 extra moves), 1 = finished. */
export function stars(moves: number, optimal: number): 1 | 2 | 3 {
  if (moves <= optimal) return 3
  if (moves <= optimal + Math.max(2, Math.ceil(optimal * 0.2))) return 2
  return 1
}

// ── Progress ───────────────────────────────────────────────────────────
export interface Progress {
  /** Best move count per completed level id. */
  best: Record<string, number>
}

export interface Store {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

const KEY = '4d-levels-v1'

export function loadProgress(store: Store | undefined): Progress {
  try {
    const raw = store?.getItem(KEY)
    const p = raw ? (JSON.parse(raw) as Progress) : null
    if (p && typeof p.best === 'object' && p.best) return { best: { ...p.best } }
  } catch {
    // Corrupt or unavailable storage: start fresh.
  }
  return { best: {} }
}

export function saveProgress(store: Store | undefined, p: Progress): void {
  try {
    store?.setItem(KEY, JSON.stringify(p))
  } catch {
    // Private mode / quota: progress just isn't persisted.
  }
}

/** Record a finish; returns true if it is a new best. */
export function recordFinish(p: Progress, id: string, moves: number): boolean {
  const prev = p.best[id]
  if (prev !== undefined && prev <= moves) return false
  p.best[id] = moves
  return true
}

/** A level is playable when it's ready and the previous level (if any) has been finished. */
export function isUnlocked(p: Progress, id: string, unlockAll = false): boolean {
  const i = LEVELS.findIndex(l => l.id === id)
  if (i < 0 || !LEVELS[i].ready) return false
  if (unlockAll || i === 0) return true
  return LEVELS[i - 1].id in p.best
}

/** First unlocked level that hasn't been finished, else the last unlocked one. */
export function currentLevel(p: Progress): Level {
  const open = LEVELS.filter(l => isUnlocked(p, l.id))
  return open.find(l => !(l.id in p.best)) ?? open[open.length - 1] ?? LEVELS[0]
}
