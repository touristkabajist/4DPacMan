/**
 * 4D grid primitives. Axis order is X, Y (vertical), Z, W (the fourth dimension).
 * The world is a bounded grid; leaving it counts as hitting a wall.
 */
export type V4 = readonly [number, number, number, number]
export type Size = readonly [number, number, number, number]

export const AXIS_X = 0
export const AXIS_Y = 1
export const AXIS_Z = 2
export const AXIS_W = 3

/** Tutorial topics a level can introduce; the UI shows matching guidance. */
export type Lesson = 'move' | 'height' | 'phase' | 'ghost' | 'mix' | 'free'

export interface Level {
  id: string
  name: string
  subtitle: string
  size: Size
  /** 1 = wall, indexed by `index()`. */
  walls: Uint8Array
  start: V4
  items: V4[]
  lesson: Lesson
  seed?: number
}

export function cellCount(size: Size): number {
  return size[0] * size[1] * size[2] * size[3]
}

export function index(size: Size, p: V4): number {
  return ((p[3] * size[1] + p[1]) * size[2] + p[2]) * size[0] + p[0]
}

export function fromIndex(size: Size, i: number): V4 {
  const x = i % size[0]
  let r = (i - x) / size[0]
  const z = r % size[2]
  r = (r - z) / size[2]
  const y = r % size[1]
  const w = (r - y) / size[1]
  return [x, y, z, w]
}

export function inBounds(size: Size, p: V4): boolean {
  return p.every((v, i) => v >= 0 && v < size[i])
}

export function isWall(level: Pick<Level, 'size' | 'walls'>, p: V4): boolean {
  return !inBounds(level.size, p) || level.walls[index(level.size, p)] === 1
}

export function add(p: V4, axis: number, delta: number): V4 {
  const r = [p[0], p[1], p[2], p[3]] as [number, number, number, number]
  r[axis] += delta
  return r
}

export function same(a: V4, b: V4): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}

/** The 8 unit moves of 4D space: ±X, ±Y, ±Z, ±W. */
export const MOVES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1], [3, 1], [3, -1],
]
