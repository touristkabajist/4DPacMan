import { add, index, isWall, same, type Level, type V4 } from './grid'

export type MoveResult =
  | { kind: 'moved'; from: V4; to: V4; axis: number; dir: number; collected: number; won: boolean }
  | { kind: 'blocked'; from: V4; to: V4; axis: number; dir: number; outOfBounds: boolean }
  | { kind: 'ignored' }

export type Snapshot = { pos: V4; mask: number; moves: number }

/** Pure play state for one attempt at a level: position, collected cores, move count, undo. */
export class Run {
  pos: V4
  mask = 0
  moves = 0
  bumps = 0
  won = false
  private history: Snapshot[] = []

  constructor(readonly level: Level) {
    this.pos = level.start
  }

  get collectedCount(): number {
    let n = 0
    for (let m = this.mask; m; m &= m - 1) n += 1
    return n
  }

  isCollected(i: number): boolean {
    return (this.mask & (1 << i)) !== 0
  }

  canEnter(p: V4): boolean {
    return !isWall(this.level, p)
  }

  tryMove(axis: number, dir: number): MoveResult {
    if (this.won) return { kind: 'ignored' }
    const from = this.pos
    const to = add(from, axis, dir)
    if (isWall(this.level, to)) {
      this.bumps += 1
      const outOfBounds = to[axis] < 0 || to[axis] >= this.level.size[axis]
      return { kind: 'blocked', from, to, axis, dir, outOfBounds }
    }
    this.history.push({ pos: from, mask: this.mask, moves: this.moves })
    this.pos = to
    this.moves += 1
    let collected = -1
    this.level.items.forEach((it, i) => {
      if (!this.isCollected(i) && same(it, to)) {
        this.mask |= 1 << i
        collected = i
      }
    })
    this.won = this.collectedCount === this.level.items.length
    return { kind: 'moved', from, to, axis, dir, collected, won: this.won }
  }

  undo(): Snapshot | null {
    if (this.won) return null
    const s = this.history.pop()
    if (!s) return null
    this.pos = s.pos
    this.mask = s.mask
    this.moves = s.moves
    return s
  }

  get canUndo(): boolean {
    return this.history.length > 0 && !this.won
  }

  cellIndex(): number {
    return index(this.level.size, this.pos)
  }
}

/** 3 stars at par, 2 within +50 %, else 1. */
export function starsFor(moves: number, par: number): number {
  if (moves <= par) return 3
  if (moves <= Math.ceil(par * 1.5)) return 2
  return 1
}
