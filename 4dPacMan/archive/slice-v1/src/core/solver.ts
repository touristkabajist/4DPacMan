import { cellCount, fromIndex, index, inBounds, MOVES, type Level, type V4 } from './grid'

/** Distances (in moves) from `from` to every cell; -1 = unreachable. Optionally lock some axes. */
export function distances(level: Pick<Level, 'size' | 'walls'>, from: V4, lockedAxes: number[] = []): Int32Array {
  const { size, walls } = level
  const dist = new Int32Array(cellCount(size)).fill(-1)
  const start = index(size, from)
  if (walls[start]) return dist
  const queue = new Int32Array(dist.length)
  let head = 0
  let tail = 0
  queue[tail++] = start
  dist[start] = 0
  while (head < tail) {
    const cur = queue[head++]
    const p = fromIndex(size, cur)
    for (const [axis, d] of MOVES) {
      if (lockedAxes.includes(axis)) continue
      const q = [p[0], p[1], p[2], p[3]] as [number, number, number, number]
      q[axis] += d
      if (!inBounds(size, q)) continue
      const n = index(size, q)
      if (walls[n] || dist[n] >= 0) continue
      dist[n] = dist[cur] + 1
      queue[tail++] = n
    }
  }
  return dist
}

export type Solution = { par: number; path: V4[] } | null

/**
 * Optimal number of moves to collect every item (any order), by BFS over (cell, collected-mask).
 * Also returns one optimal path for the debug overlay. Item count is small (≤ 8) by design.
 */
export function solve(level: Level, from: V4 = level.start, initialMask = 0): Solution {
  const { size, walls, items } = level
  const cells = cellCount(size)
  const k = items.length
  const full = (1 << k) - 1
  const itemAt = new Int8Array(cells).fill(-1)
  items.forEach((it, i) => (itemAt[index(size, it)] = i))
  const states = cells << k
  const prev = new Int32Array(states).fill(-2)
  const startCell = index(size, from)
  let startMask = initialMask
  if (itemAt[startCell] >= 0) startMask |= 1 << itemAt[startCell]
  const s0 = (startCell << k) | startMask
  const queue = new Int32Array(states)
  let head = 0
  let tail = 0
  queue[tail++] = s0
  prev[s0] = -1
  let goal = -1
  if (startMask === full) goal = s0
  while (head < tail && goal < 0) {
    const s = queue[head++]
    const cell = s >> k
    const mask = s & full
    const p = fromIndex(size, cell)
    for (const [axis, d] of MOVES) {
      const q = [p[0], p[1], p[2], p[3]] as [number, number, number, number]
      q[axis] += d
      if (!inBounds(size, q)) continue
      const n = index(size, q)
      if (walls[n]) continue
      const m = itemAt[n] >= 0 ? mask | (1 << itemAt[n]) : mask
      const ns = (n << k) | m
      if (prev[ns] !== -2) continue
      prev[ns] = s
      if (m === full) {
        goal = ns
        break
      }
      queue[tail++] = ns
    }
  }
  if (goal < 0) return null
  const path: V4[] = []
  for (let s = goal; s !== -1; s = prev[s]) path.push(fromIndex(size, s >> k))
  path.reverse()
  return { par: path.length - 1, path }
}
