/** Small synthesized SFX via WebAudio; no audio files. Context is created on first user gesture. */
export type Sfx = 'step' | 'bump' | 'phase' | 'phaseBlocked' | 'collect' | 'win' | 'undo' | 'click'

export class Audio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  muted = false

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.5
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setMuted(m: boolean): void {
    this.muted = m
  }

  play(s: Sfx, pitch = 0): void {
    if (this.muted || !this.ctx || !this.master) return
    const t = this.ctx.currentTime
    switch (s) {
      case 'step':
        this.tone('triangle', 330 + pitch * 20, 300, t, 0.06, 0.12)
        break
      case 'undo':
        this.tone('triangle', 300, 420, t, 0.08, 0.1)
        break
      case 'click':
        this.tone('sine', 660, 660, t, 0.04, 0.08)
        break
      case 'bump':
        this.tone('square', 110, 70, t, 0.1, 0.12)
        break
      case 'phase':
        this.tone('sine', pitch > 0 ? 220 : 520, pitch > 0 ? 520 : 220, t, 0.32, 0.18)
        this.tone('sine', pitch > 0 ? 330 : 780, pitch > 0 ? 780 : 330, t + 0.03, 0.3, 0.08)
        break
      case 'phaseBlocked':
        this.tone('sawtooth', 200, 120, t, 0.18, 0.08)
        this.tone('square', 90, 60, t + 0.05, 0.12, 0.08)
        break
      case 'collect': {
        const base = 660 * 2 ** (pitch / 12)
        this.tone('sine', base, base, t, 0.12, 0.2)
        this.tone('sine', base * 1.5, base * 1.5, t + 0.07, 0.2, 0.16)
        break
      }
      case 'win':
        ;[523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.1, 0.3, 0.18))
        break
    }
  }

  private tone(type: OscillatorType, f0: number, f1: number, at: number, dur: number, vol: number): void {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(f0, at)
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(vol, at + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    o.connect(g).connect(this.master!)
    o.start(at)
    o.stop(at + dur + 0.02)
  }
}
