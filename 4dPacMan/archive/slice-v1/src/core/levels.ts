import { cellCount, fromIndex, index, same, type Lesson, type Level, type Size, type V4 } from './grid'
import { randInt, rng } from './rng'
import { distances, solve } from './solver'

/**
 * Handcrafted tutorial levels in ASCII.
 *   layers[w][z] = one row; within a row, Y levels are separated by `|` (y=0 first).
 *   '#' wall · '.' empty · 'S' start · 'o' light core
 */
type Ascii = { id: string; name: string; subtitle: string; lesson: Lesson; layers: string[][] }

const TUTORIALS: Ascii[] = [
  {
    id: 't1', name: '初识', subtitle: '收集所有光核', lesson: 'move',
    layers: [[
      'S..#o',
      '.#...',
      '.#.#.',
      'o..#.',
      '##.o.',
    ]],
  },
  {
    id: 't2', name: '高度', subtitle: '空间不止前后左右', lesson: 'height',
    layers: [[
      'S.#.|....',
      '..#o|.#..',
      '###.|.#o.',
      'o...|....',
    ]],
  },
  {
    id: 't3', name: '第四个方向', subtitle: '墙壁只存在于某个切片', lesson: 'phase',
    layers: [
      [
        'S.#.o',
        '..#..',
        '..#..',
        '..#..',
        'o.#.o',
      ],
      [
        '.....',
        '.#.#.',
        '.....',
        '.#.#.',
        '.....',
      ],
    ],
  },
  {
    id: 't4', name: '幽灵光核', subtitle: '半透明的光核在别的切片里', lesson: 'ghost',
    layers: [
      [
        'S.#.o',
        '..#..',
        '###..',
        '.....',
        '..###',
      ],
      [
        '.....',
        '.#o#.',
        '.#.#.',
        '.#.#.',
        '.....',
      ],
      [
        'o#...',
        '.#.#.',
        '.#.#.',
        '...#.',
        '####o',
      ],
    ],
  },
]

export function parseAscii(def: Ascii): Level {
  const nw = def.layers.length
  const nz = def.layers[0].length
  const ny = def.layers[0][0].split('|').length
  const nx = def.layers[0][0].split('|')[0].length
  const size: Size = [nx, ny, nz, nw]
  const walls = new Uint8Array(cellCount(size))
  let start: V4 | null = null
  const items: V4[] = []
  def.layers.forEach((rows, w) => {
    if (rows.length !== nz) throw new Error(`${def.id}: slice ${w} has ${rows.length} rows, expected ${nz}`)
    rows.forEach((row, z) => {
      const ys = row.split('|')
      if (ys.length !== ny) throw new Error(`${def.id}: row ${z} of slice ${w} has ${ys.length} heights`)
      ys.forEach((line, y) => {
        if (line.length !== nx) throw new Error(`${def.id}: row ${z} of slice ${w} y${y} has width ${line.length}`)
        for (let x = 0; x < nx; x += 1) {
          const ch = line[x]
          const p: V4 = [x, y, z, w]
          if (ch === '#') walls[index(size, p)] = 1
          else if (ch === 'S') start = p
          else if (ch === 'o') items.push(p)
          else if (ch !== '.') throw new Error(`${def.id}: unknown cell '${ch}'`)
        }
      })
    })
  })
  if (!start) throw new Error(`${def.id}: missing start`)
  return { id: def.id, name: def.name, subtitle: def.subtitle, size, walls, start, items, lesson: def.lesson }
}

export type GenParams = { size: Size; items: number; density: number }

/**
 * Procedural level: walls are cross-sections of random 4D hyper-ellipsoids and hyper-boxes, so
 * obstacles grow and shrink smoothly as you move along W — exactly how a 4D object would pass
 * through our 3D slice. Candidates are rejected until at least one core *requires* moving in W,
 * and the one whose optimal solution length is closest to a target is kept.
 */
export function generate(params: GenParams, seed: number, meta: { id: string; name: string; subtitle: string; lesson?: Lesson }): Level {
  const r = rng(seed)
  const { size, items: k, density } = params
  const cells = cellCount(size)
  const target = k * 5 + size[3] * 2 + size[1] * 2
  let best: { level: Level; score: number } | null = null

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const walls = new Uint8Array(cells)
    let filled = 0
    let guard = 0
    while (filled / cells < density && guard++ < 60) {
      const box = r() < 0.4
      const c = size.map(n => r() * (n - 1)) as number[]
      const rad = [0.6 + r() * 1.4, 0.4 + r() * 0.9, 0.6 + r() * 1.4, 0.5 + r() * 1.2]
      for (let i = 0; i < cells; i += 1) {
        if (walls[i]) continue
        const p = fromIndex(size, i)
        let inside: boolean
        if (box) inside = p.every((v, a) => Math.abs(v - c[a]) <= rad[a] * 0.8)
        else inside = p.reduce((s, v, a) => s + ((v - c[a]) / rad[a]) ** 2, 0) <= 1
        if (inside) {
          walls[i] = 1
          filled += 1
        }
      }
    }
    const free: number[] = []
    for (let i = 0; i < cells; i += 1) if (!walls[i]) free.push(i)
    if (free.length < k + 4) continue
    const start = fromIndex(size, free[Math.floor(r() * free.length)])
    const dist = distances({ size, walls }, start)
    const reach = free.filter(i => dist[i] > 1)
    if (reach.length < k * 3 || reach.length < free.length * 0.55) continue

    // Pick cores: spread them over W layers first, keep them apart from each other.
    const chosen: V4[] = []
    const layers = Array.from({ length: size[3] }, (_, w) => w).sort(() => r() - 0.5)
    for (let tries = 0; chosen.length < k && tries < 400; tries += 1) {
      const wantW = chosen.length < layers.length ? layers[chosen.length] : -1
      const pool = wantW >= 0 ? reach.filter(i => fromIndex(size, i)[3] === wantW) : reach
      if (!pool.length) continue
      const p = fromIndex(size, pool[randInt(r, 0, pool.length - 1)])
      const far = chosen.every(q => p.reduce((s, v, a) => s + Math.abs(v - q[a]), 0) >= 3)
      if (far && !same(p, start)) chosen.push(p)
    }
    if (chosen.length < k) continue

    // At least one core must be unreachable without moving through W.
    const flat = distances({ size, walls }, start, [3])
    const needsW = chosen.filter(p => flat[index(size, p)] < 0).length
    if (needsW === 0) continue

    const level: Level = { ...meta, lesson: meta.lesson ?? 'free', size, walls, start, items: chosen, seed }
    const sol = solve(level)
    if (!sol) continue
    const score = Math.abs(sol.par - target) - needsW * 1.5
    if (!best || score < best.score) best = { level, score }
    if (attempt > 20 && best.score < 2) break
  }
  if (!best) throw new Error(`generator failed for seed ${seed}`)
  return best.level
}

/** Campaign: 4 tutorials, then generated levels of growing size; beyond that, endless. */
const CAMPAIGN: { name: string; subtitle: string; params: GenParams; seed: number; lesson?: Lesson }[] = [
  { name: '交错', subtitle: '高度与切片同时出现', params: { size: [4, 2, 4, 2], items: 3, density: 0.32 }, seed: 501, lesson: 'mix' },
  { name: '回廊', subtitle: '三片世界', params: { size: [5, 2, 5, 3], items: 4, density: 0.34 }, seed: 602 },
  { name: '穿梭', subtitle: '四片世界', params: { size: [5, 2, 5, 4], items: 4, density: 0.36 }, seed: 703 },
  { name: '织网', subtitle: '障碍在切片间生长', params: { size: [6, 2, 6, 4], items: 5, density: 0.36 }, seed: 804 },
  { name: '高塔', subtitle: '更高的空间', params: { size: [5, 3, 5, 4], items: 5, density: 0.38 }, seed: 905 },
  { name: '超立方', subtitle: '五片世界', params: { size: [6, 3, 6, 5], items: 6, density: 0.38 }, seed: 1006 },
]

export const CAMPAIGN_LENGTH = TUTORIALS.length + CAMPAIGN.length

const cache = new Map<number, Level>()

/** Level by 0-based number. Numbers beyond the campaign are endless generated levels. */
export function levelAt(n: number): Level {
  const hit = cache.get(n)
  if (hit) return hit
  let level: Level
  if (n < TUTORIALS.length) {
    level = parseAscii(TUTORIALS[n])
  } else if (n < CAMPAIGN_LENGTH) {
    const c = CAMPAIGN[n - TUTORIALS.length]
    level = generate(c.params, c.seed, { id: `c${n + 1}`, name: c.name, subtitle: c.subtitle, lesson: c.lesson })
  } else {
    const e = n - CAMPAIGN_LENGTH
    const big = e % 2
    level = generate(
      { size: [6 + big, 3, 6 + big, 5], items: 6, density: 0.38 },
      7919 * (e + 1),
      { id: `e${e + 1}`, name: `无尽 ${e + 1}`, subtitle: '随机生成的四维迷宫' },
    )
  }
  cache.set(n, level)
  return level
}

export function tutorialCount(): number {
  return TUTORIALS.length
}
