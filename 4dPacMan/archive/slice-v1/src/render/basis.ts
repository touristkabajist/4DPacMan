/**
 * Camera-relative basis on the XZ grid for each 90° camera yaw. `forward` is "screen up" and
 * `right` is "screen right", both as [dx, dz]. Used for controls and for rotating the minimaps
 * so they always match the main view.
 */
export type Basis = { forward: [number, number]; right: [number, number] }

const BASES: Basis[] = [
  { forward: [0, -1], right: [1, 0] },
  { forward: [-1, 0], right: [0, -1] },
  { forward: [0, 1], right: [-1, 0] },
  { forward: [1, 0], right: [0, 1] },
]

export function basis(yawIndex: number): Basis {
  return BASES[((yawIndex % 4) + 4) % 4]
}

/** Grid axis (0 = X, 2 = Z) and direction for a screen direction in a given camera yaw. */
export function screenToGrid(yawIndex: number, screen: 'up' | 'down' | 'left' | 'right'): { axis: number; dir: number } {
  const b = basis(yawIndex)
  let v: [number, number]
  if (screen === 'up') v = b.forward
  else if (screen === 'down') v = [-b.forward[0], -b.forward[1]]
  else if (screen === 'right') v = b.right
  else v = [-b.right[0], -b.right[1]]
  return v[0] !== 0 ? { axis: 0, dir: v[0] } : { axis: 2, dir: v[1] }
}
