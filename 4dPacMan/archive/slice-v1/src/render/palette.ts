import * as THREE from 'three'

/**
 * Every W slice has its own hue. The whole environment is tinted by the current slice, cores are
 * coloured by the slice they live in, and the dimension strip uses the same colours, so the
 * player learns "where" in W something is by colour instead of by coordinates.
 */
export const SLICE_HUES = ['#ff5d73', '#ffb547', '#4ee08a', '#3ec8ff', '#a77bff', '#ff7ad9']
export const SLICE_NAMES = ['赤', '琥', '翠', '青', '紫', '粉']

export function sliceColor(w: number): THREE.Color {
  return new THREE.Color(SLICE_HUES[((w % SLICE_HUES.length) + SLICE_HUES.length) % SLICE_HUES.length])
}

export function sliceHex(w: number): string {
  return SLICE_HUES[((w % SLICE_HUES.length) + SLICE_HUES.length) % SLICE_HUES.length]
}

export function sliceName(w: number): string {
  return SLICE_NAMES[((w % SLICE_NAMES.length) + SLICE_NAMES.length) % SLICE_NAMES.length]
}

/** Wall colour for a slice: the hue, desaturated and darkened so cores stay the brightest thing. */
export function wallColor(w: number, out = new THREE.Color()): THREE.Color {
  const c = sliceColor(w)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  return out.setHSL(hsl.h, hsl.s * 0.45, 0.42)
}

export function floorColor(w: number, out = new THREE.Color()): THREE.Color {
  const c = sliceColor(w)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  return out.setHSL(hsl.h, hsl.s * 0.35, 0.16)
}
