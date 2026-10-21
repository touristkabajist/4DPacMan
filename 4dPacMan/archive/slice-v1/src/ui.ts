import type { Level, V4 } from './core/grid'
import type { Method } from './input'
import { sliceHex, sliceName } from './render/palette'

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (html) el.innerHTML = html
  return el
}

/** Keyboard chip or touch glyph for an input, chosen by the current input method. */
export function keyLabel(m: Method, k: 'move' | 'up' | 'down' | 'wprev' | 'wnext' | 'undo' | 'rotate'): string {
  const kb: Record<typeof k, string> = {
    move: '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>',
    up: '<kbd>R</kbd>',
    down: '<kbd>F</kbd>',
    wprev: '<kbd>Q</kbd>',
    wnext: '<kbd>E</kbd>',
    undo: '<kbd>Z</kbd>',
    rotate: '<kbd>,</kbd><kbd>.</kbd> 或拖拽',
  }
  const touch: Record<typeof k, string> = {
    move: '<b class="glyph">✥</b>方向键/滑动屏幕',
    up: '<b class="glyph">▲</b>',
    down: '<b class="glyph">▼</b>',
    wprev: '<b class="glyph">◀ 切片</b>',
    wnext: '<b class="glyph">切片 ▶</b>',
    undo: '<b class="glyph">↶</b>',
    rotate: '双指拖动',
  }
  return (m === 'touch' ? touch : kb)[k]
}

export type DebugInfo = { level: Level; pos: V4; mask: number; moves: number; par: number; bumps: number; yaw: number; method: Method; fps: number }

/**
 * All HTML/CSS chrome around the 3D view. The UI owns no game state: main.ts pushes state in and
 * subscribes to the callbacks.
 */
export class Ui {
  readonly root: HTMLElement
  readonly stage: HTMLElement
  readonly bottom: HTMLElement
  readonly stripHost: HTMLElement
  readonly pad: HTMLElement
  readonly btn: Record<string, HTMLButtonElement> = {}
  private readonly levelName: HTMLElement
  private readonly pips: HTMLElement
  private readonly moves: HTMLElement
  private readonly coach: HTMLElement
  private readonly toastEl: HTMLElement
  private readonly card: HTMLElement
  private readonly gauge: HTMLElement
  private readonly debugEl: HTMLElement
  private readonly debugBody: HTMLElement
  private readonly sliceTag: HTMLElement
  readonly overlay: HTMLElement
  private toastTimer = 0
  private cardTimer = 0

  constructor(canvas: HTMLCanvasElement) {
    this.root = document.getElementById('ui')!
    this.root.className = 'app'

    // ── HUD ────────────────────────────────────────────────────────────
    const hud = h('header', 'hud')
    const left = h('div', 'hud-left')
    this.btn.menu = this.iconBtn('menu', '菜单', '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>')
    this.levelName = h('div', 'level-name')
    left.append(this.btn.menu, this.levelName)
    this.pips = h('div', 'pips')
    this.pips.setAttribute('aria-label', '已收集光核')
    const right = h('div', 'hud-right')
    this.moves = h('div', 'moves')
    this.btn.undo = this.iconBtn('undo', '撤销', '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>')
    this.btn.restart = this.iconBtn('restart', '重来', '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>')
    this.btn.help = this.iconBtn('help', '玩法', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><path d="M12 17.5h.01"/></svg>')
    this.btn.mute = this.iconBtn('mute', '声音', '')
    right.append(this.moves, this.btn.undo, this.btn.restart, this.btn.help, this.btn.mute)
    hud.append(left, this.pips, right)

    // ── Stage ──────────────────────────────────────────────────────────
    this.stage = h('main', 'stage')
    this.stage.appendChild(canvas)
    this.coach = h('div', 'coach')
    this.coach.setAttribute('role', 'status')
    this.coach.setAttribute('aria-live', 'polite')
    this.toastEl = h('div', 'toast')
    this.card = h('div', 'level-card')
    this.sliceTag = h('div', 'slice-tag')
    this.gauge = h('div', 'gauge')
    this.gauge.setAttribute('aria-label', '高度')
    const cam = h('div', 'cam-btns')
    this.btn.rotL = this.iconBtn('rotL', '向左旋转视角', '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>')
    this.btn.rotR = this.iconBtn('rotR', '向右旋转视角', '<svg viewBox="0 0 24 24" style="transform:scaleX(-1)"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>')
    cam.append(this.btn.rotL, this.btn.rotR)
    this.stage.append(this.sliceTag, this.coach, this.toastEl, this.card, this.gauge, cam)

    // ── Bottom: dimension strip + touch pad ───────────────────────────
    this.bottom = h('footer', 'bottom')
    this.stripHost = h('div', 'strip-host')
    const stripLabel = h('div', 'strip-label', '<span>第四维</span><i></i>')
    this.stripHost.appendChild(stripLabel)
    this.pad = h('div', 'pad')
    const dpad = h('div', 'dpad')
    for (const [dir, glyph, label] of [['up', '▲', '前'], ['left', '◀', '左'], ['right', '▶', '右'], ['down', '▼', '后']] as const) {
      const b = h('button', `pad-btn d-${dir}`, glyph)
      b.setAttribute('aria-label', label)
      this.btn['d' + dir] = b
      dpad.appendChild(b)
    }
    const dims = h('div', 'dims')
    const ycol = h('div', 'ycol')
    this.btn.yup = h('button', 'pad-btn y-btn', '<span>▲</span><small>上</small>')
    this.btn.ydown = h('button', 'pad-btn y-btn', '<span>▼</span><small>下</small>')
    this.btn.yup.setAttribute('aria-label', '向上')
    this.btn.ydown.setAttribute('aria-label', '向下')
    ycol.append(this.btn.yup, this.btn.ydown)
    const wrow = h('div', 'wrow')
    this.btn.wprev = h('button', 'pad-btn w-btn', '')
    this.btn.wnext = h('button', 'pad-btn w-btn', '')
    wrow.append(this.btn.wprev, this.btn.wnext)
    dims.append(ycol, wrow)
    this.pad.append(dpad, dims)
    const legend = h('div', 'legend')
    legend.innerHTML = `
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动</span>
      <span class="ly"><kbd>R</kbd><kbd>F</kbd> 上下</span>
      <span class="lw"><kbd>Q</kbd><kbd>E</kbd> 切换切片</span>
      <span><kbd>Z</kbd> 撤销</span>
      <span>拖拽 / <kbd>,</kbd><kbd>.</kbd> 旋转</span>`
    this.bottom.append(this.stripHost, this.pad, legend)

    this.overlay = h('div', 'overlay')
    this.debugEl = h('aside', 'debug')
    this.debugEl.innerHTML = '<div class="debug-head">DEBUG <small>` 切换</small></div>'
    this.debugBody = h('div', 'debug-body')
    const dbtn = h('div', 'debug-btns')
    for (const [k, t] of [['dbgSolve', '显示解'], ['dbgStep', '自动走一步'], ['dbgPrev', '上一关'], ['dbgNext', '下一关'], ['dbgUnlock', '解锁全部']] as const) {
      this.btn[k] = h('button', '', t)
      dbtn.appendChild(this.btn[k])
    }
    this.debugEl.append(this.debugBody, dbtn)

    this.root.append(hud, this.stage, this.bottom, this.overlay, this.debugEl)
  }

  private iconBtn(key: string, label: string, svg: string): HTMLButtonElement {
    const b = h('button', `icon-btn ib-${key}`, svg)
    b.setAttribute('aria-label', label)
    b.title = label
    return b
  }

  setMethod(m: Method): void {
    document.body.classList.toggle('touch', m === 'touch')
    document.body.classList.toggle('keyboard', m === 'keyboard')
  }

  setMuted(m: boolean): void {
    this.btn.mute.innerHTML = m
      ? '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>'
    this.btn.mute.setAttribute('aria-label', m ? '打开声音' : '静音')
  }

  setLevel(n: number, level: Level): void {
    this.levelName.innerHTML = `<b>${n + 1}</b><span>${level.name}</span>`
    this.pips.innerHTML = ''
    level.items.forEach(it => {
      const p = h('i', 'pip')
      p.style.setProperty('--hue', sliceHex(it[3]))
      this.pips.appendChild(p)
    })
    const [, ny, , nw] = level.size
    document.body.classList.toggle('has-y', ny > 1)
    document.body.classList.toggle('has-w', nw > 1)
    this.gauge.innerHTML = ''
    for (let y = ny - 1; y >= 0; y -= 1) this.gauge.appendChild(h('i', 'g-step'))
    this.showCard(n, level)
  }

  update(level: Level, pos: V4, mask: number, moves: number, par: number, canUndo: boolean): void {
    ;[...this.pips.children].forEach((p, i) => p.classList.toggle('got', (mask & (1 << i)) !== 0))
    this.moves.innerHTML = `<span>步数</span><b>${moves}</b><small>/ ${par}</small>`
    this.btn.undo.disabled = !canUndo
    const ny = level.size[1]
    ;[...this.gauge.children].forEach((g, i) => g.classList.toggle('on', ny - 1 - i === pos[1]))
    const nw = level.size[3]
    const w = pos[3]
    this.sliceTag.style.setProperty('--hue', sliceHex(w))
    this.sliceTag.innerHTML = nw > 1 ? `<i></i>${sliceName(w)} · 切片 ${w + 1}/${nw}` : ''
    this.sliceTag.hidden = nw <= 1
    const setW = (b: HTMLButtonElement, tw: number, glyph: string, first: boolean) => {
      const ok = tw >= 0 && tw < nw
      b.disabled = !ok
      b.style.setProperty('--hue', ok ? sliceHex(tw) : '#555')
      b.innerHTML = first ? `<span>${glyph}</span><small>${ok ? sliceName(tw) : '—'}</small>` : `<small>${ok ? sliceName(tw) : '—'}</small><span>${glyph}</span>`
      b.setAttribute('aria-label', ok ? `进入${sliceName(tw)}切片` : '没有更多切片')
    }
    setW(this.btn.wprev, w - 1, '◀', true)
    setW(this.btn.wnext, w + 1, '▶', false)
    this.btn.yup.disabled = pos[1] >= ny - 1
    this.btn.ydown.disabled = pos[1] <= 0
  }

  setHue(hex: string): void {
    document.documentElement.style.setProperty('--slice', hex)
  }

  coachSay(html: string | null): void {
    if (!html) {
      this.coach.classList.remove('show')
      return
    }
    if (this.coach.innerHTML !== html) {
      this.coach.innerHTML = html
      this.coach.classList.remove('show')
      void this.coach.offsetWidth
    }
    this.coach.classList.add('show')
  }

  toast(html: string, kind: 'warn' | 'info' = 'info'): void {
    this.toastEl.innerHTML = html
    this.toastEl.className = `toast show ${kind}`
    window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1600)
  }

  private showCard(n: number, level: Level): void {
    this.card.innerHTML = `<small>第 ${n + 1} 关</small><h2>${level.name}</h2><p>${level.subtitle}</p>`
    this.card.classList.remove('show')
    void this.card.offsetWidth
    this.card.classList.add('show')
    window.clearTimeout(this.cardTimer)
    this.cardTimer = window.setTimeout(() => this.card.classList.remove('show'), 1800)
  }

  collectPulse(i: number): void {
    const p = this.pips.children[i] as HTMLElement | undefined
    if (!p) return
    p.classList.remove('pop')
    void p.offsetWidth
    p.classList.add('pop')
  }

  shakeHud(): void {
    this.stage.classList.remove('hit')
    void this.stage.offsetWidth
    this.stage.classList.add('hit')
  }

  // ── Overlays ─────────────────────────────────────────────────────────
  showOverlay(content: HTMLElement | null, kind = ''): void {
    this.overlay.innerHTML = ''
    this.overlay.className = `overlay ${kind}`
    if (!content) {
      this.overlay.classList.remove('open')
      return
    }
    this.overlay.appendChild(content)
    this.overlay.classList.add('open')
    const first = content.querySelector<HTMLElement>('[data-autofocus]') ?? content.querySelector<HTMLElement>('button')
    first?.focus({ preventScroll: true })
  }

  get overlayOpen(): boolean {
    return this.overlay.classList.contains('open')
  }

  titleScreen(hasProgress: boolean, cb: { play: () => void; levels: () => void; help: () => void; secret: () => void }): void {
    const el = h('div', 'title-screen')
    el.innerHTML = `
      <div class="logo" aria-hidden="true">
        <svg viewBox="-60 -60 120 120" class="logo-cube">${tesseractSvg()}</svg>
      </div>
      <h1><span>TESSERACT RUN</span>四维拾光</h1>
      <p class="tag">在四维迷宫中穿梭切片，收集全部光核</p>
      <div class="menu">
        <button class="btn primary" data-k="play" data-autofocus>${hasProgress ? '继续游戏' : '开始游戏'}</button>
        <button class="btn" data-k="levels">选择关卡</button>
        <button class="btn ghost" data-k="help">什么是第四维？</button>
      </div>
      <p class="foot">键盘 · 触屏 均可游玩</p>`
    el.querySelector<HTMLButtonElement>('[data-k=play]')!.onclick = cb.play
    el.querySelector<HTMLButtonElement>('[data-k=levels]')!.onclick = cb.levels
    el.querySelector<HTMLButtonElement>('[data-k=help]')!.onclick = cb.help
    // Hidden: tap the logo 5 times to toggle the debug panel on devices without a keyboard.
    let taps = 0
    let last = 0
    el.querySelector('.logo')!.addEventListener('click', () => {
      const now = performance.now()
      taps = now - last < 600 ? taps + 1 : 1
      last = now
      if (taps >= 5) {
        taps = 0
        cb.secret()
      }
    })
    this.showOverlay(el, 'title')
  }

  levelSelect(total: number, unlocked: number, stars: (n: number) => number, names: (n: number) => string, pick: (n: number) => void, back: () => void): void {
    const el = h('div', 'panel levels')
    el.innerHTML = `<h2>选择关卡</h2><div class="grid"></div><button class="btn ghost" data-k="back">返回</button>`
    const grid = el.querySelector('.grid')!
    for (let n = 0; n < total; n += 1) {
      const locked = n > unlocked
      const b = h('button', `lv${locked ? ' locked' : ''}`)
      const s = stars(n)
      b.innerHTML = `<b>${n + 1}</b><span>${locked ? '未解锁' : names(n)}</span><i>${locked ? '🔒' : '★'.repeat(s) + '☆'.repeat(3 - s)}</i>`
      b.disabled = locked
      if (n === unlocked) b.setAttribute('data-autofocus', '')
      b.onclick = () => pick(n)
      grid.appendChild(b)
    }
    el.querySelector<HTMLButtonElement>('[data-k=back]')!.onclick = back
    this.showOverlay(el)
  }

  winScreen(o: { n: number; moves: number; par: number; stars: number; best: number; last: boolean }, next: () => void, retry: () => void, menu: () => void): void {
    const el = h('div', 'panel win')
    const starsHtml = [0, 1, 2].map(i => `<i class="${i < o.stars ? 'on' : ''}" style="--d:${i * 0.15}s">★</i>`).join('')
    const msg = o.stars === 3 ? (o.moves < o.par ? '比最优解还短？！' : '完美路线！') : o.stars === 2 ? '再短一点就是完美' : '收集完成'
    el.innerHTML = `
      <small>第 ${o.n + 1} 关 完成</small>
      <div class="stars">${starsHtml}</div>
      <h2>${msg}</h2>
      <div class="stats"><div><span>步数</span><b>${o.moves}</b></div><div><span>最优</span><b>${o.par}</b></div><div><span>最佳</span><b>${o.best}</b></div></div>
      <div class="menu">
        <button class="btn primary" data-k="next" data-autofocus>${o.last ? '进入无尽模式' : '下一关'}</button>
        <button class="btn" data-k="retry">再来一次</button>
        <button class="btn ghost" data-k="menu">关卡列表</button>
      </div>`
    el.querySelector<HTMLButtonElement>('[data-k=next]')!.onclick = next
    el.querySelector<HTMLButtonElement>('[data-k=retry]')!.onclick = retry
    el.querySelector<HTMLButtonElement>('[data-k=menu]')!.onclick = menu
    this.showOverlay(el, 'dim')
  }

  helpScreen(m: Method, close: () => void): void {
    const el = h('div', 'panel help')
    const sw = [0, 1, 2, 3].map(w => `<i style="--hue:${sliceHex(w)}">${sliceName(w)}</i>`).join('')
    el.innerHTML = `
      <h2>什么是第四维？</h2>
      <div class="help-grid">
        <section>
          <div class="illus flat"><svg viewBox="0 0 160 70">${flatlandSvg()}</svg></div>
          <h3>先想象二维</h3>
          <p>一个生活在纸面上的扁平生物，被一条线挡住就过不去。但如果它能“离开纸面”，跳到上面一张纸，就能绕过去——在它看来，自己凭空穿过了墙。</p>
        </section>
        <section>
          <div class="illus slices">${sw}</div>
          <h3>你的世界是一张“切片”</h3>
          <p>四维迷宫由多个三维切片叠成，每片有自己的颜色。你一次只能看到所在的切片，但可以沿第四个方向一步跨到相邻切片。</p>
        </section>
        <section>
          <div class="illus ghost"><span class="g1"></span><span class="g2"></span></div>
          <h3>读懂提示</h3>
          <p><b>实心光核</b>就在本片；<b>半透明带光环</b>的在别的切片，<b>颜色</b>告诉你是哪一片，<b>光环数</b>表示相隔几片。墙壁在切换时生长、消失，就像四维物体穿过三维空间。</p>
        </section>
        <section>
          <div class="illus strip"><span></span><span class="cur"></span><span class="x"></span></div>
          <h3>维度带</h3>
          <p>底部的小地图同时展示所有切片。<b>白色菱形</b>是你；<b>虚线框</b>是你切换过去会落在哪里；<b>红叉</b>表示那里有墙，过不去。</p>
        </section>
      </div>
      <div class="controls-help">
        <div><span>移动</span>${keyLabel(m, 'move')}</div>
        <div><span>上 / 下</span>${keyLabel(m, 'up')} ${keyLabel(m, 'down')}</div>
        <div><span>切换切片</span>${keyLabel(m, 'wprev')} ${keyLabel(m, 'wnext')}</div>
        <div><span>撤销</span>${keyLabel(m, 'undo')}</div>
        <div><span>旋转视角</span>${keyLabel(m, 'rotate')}</div>
      </div>
      <button class="btn primary" data-k="close" data-autofocus>明白了</button>`
    el.querySelector<HTMLButtonElement>('[data-k=close]')!.onclick = close
    this.showOverlay(el, 'dim')
  }

  // ── Debug ────────────────────────────────────────────────────────────
  get debugOpen(): boolean {
    return this.debugEl.classList.contains('open')
  }

  toggleDebug(on = !this.debugOpen): void {
    this.debugEl.classList.toggle('open', on)
  }

  debug(d: DebugInfo): void {
    if (!this.debugOpen) return
    const [x, y, z, w] = d.pos
    const s = d.level.size
    this.debugBody.innerHTML = `
      <div class="coord"><span class="ax x">x</span>${x}<span class="ax y">y</span>${y}<span class="ax z">z</span>${z}<span class="ax w">w</span>${w}</div>
      <dl>
        <dt>level</dt><dd>${d.level.id} · ${d.level.name}</dd>
        <dt>size</dt><dd>${s.join(' × ')}</dd>
        <dt>seed</dt><dd>${d.level.seed ?? 'ascii'}</dd>
        <dt>items</dt><dd>${d.level.items.map((p, i) => `<span class="${d.mask & (1 << i) ? 'got' : ''}">(${p.join(',')})</span>`).join(' ')}</dd>
        <dt>moves</dt><dd>${d.moves} / par ${d.par} · bumps ${d.bumps}</dd>
        <dt>camera</dt><dd>yaw ${d.yaw * 90}° · ${d.method}</dd>
        <dt>fps</dt><dd>${d.fps.toFixed(0)}</dd>
      </dl>`
  }
}

function tesseractSvg(): string {
  const o = 34
  const i = 16
  const sq = (r: number) => `<rect x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}"/>`
  const lines = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => `<line x1="${a * i}" y1="${b * i}" x2="${a * o}" y2="${b * o}"/>`).join('')
  return `<g class="outer">${sq(o)}</g><g class="inner">${sq(i)}</g><g class="links">${lines}</g>`
}

function flatlandSvg(): string {
  return `
    <path d="M10 52 L70 40 L150 40 L90 52 Z" class="sheet a"/>
    <path d="M10 30 L70 18 L150 18 L90 30 Z" class="sheet b"/>
    <line x1="72" y1="42" x2="72" y2="50" class="wall"/><line x1="58" y1="43" x2="86" y2="49" class="wall"/>
    <circle cx="45" cy="47" r="3.5" class="dot"/><circle cx="110" cy="45" r="3.5" class="goal"/>
    <path d="M45 44 C45 20, 110 18, 110 42" class="arc"/>`
}
