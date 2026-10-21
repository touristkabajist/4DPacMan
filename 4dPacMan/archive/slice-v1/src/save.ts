/** Progress in localStorage. Corrupt or missing data falls back to a fresh save. */
export type Save = { unlocked: number; stars: Record<string, number>; best: Record<string, number>; muted: boolean; seenHelp: boolean }

const KEY = 'tesseract-run/v1'

export function loadSave(): Save {
  const fresh: Save = { unlocked: 0, stars: {}, best: {}, muted: false, seenHelp: false }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return fresh
    const d = JSON.parse(raw) as Partial<Save>
    return {
      unlocked: Number.isInteger(d.unlocked) && d.unlocked! >= 0 ? d.unlocked! : 0,
      stars: typeof d.stars === 'object' && d.stars ? d.stars : {},
      best: typeof d.best === 'object' && d.best ? d.best : {},
      muted: d.muted === true,
      seenHelp: d.seenHelp === true,
    }
  } catch {
    return fresh
  }
}

export function writeSave(s: Save): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable (private mode): progress is session-only */
  }
}
