import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { index, type Level, type V4 } from '../core/grid'
import { floorColor, sliceColor, wallColor } from './palette'
import { Tesseract } from './tesseract'

const easeOut = (t: number) => 1 - (1 - t) ** 3
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const HALF_PI = Math.PI / 2

type ItemView = {
  pos: V4
  group: THREE.Group
  core: THREE.Mesh
  mat: THREE.MeshStandardMaterial
  halo: THREE.Sprite
  rings: THREE.Mesh[]
  collected: boolean
  /** 1 = fully visible, animates to 0 when collected. */
  life: number
}

type Particle = { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; color: THREE.Color }

/**
 * The main view: the 3D slice of the 4D world at the player's W. Walls are instanced cubes whose
 * scale morphs when the slice changes (obstacles grow/shrink like a 4D body passing through our
 * space); the scene hue follows the slice colour; cores in other slices are drawn as ghosts.
 */
export class SliceView {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200)
  level!: Level
  /** Free yaw (radians); snaps to multiples of 90° when not dragging. */
  yaw = 0
  pitch = 0.98
  zoom = 1
  dragging = false
  title = false

  private w = 0
  private prevW = 0
  private root = new THREE.Group()
  private walls?: THREE.InstancedMesh
  private wallFrom = new Float32Array(0)
  private wallTo = new Float32Array(0)
  private wallCur = new Float32Array(0)
  private morph = 1
  private morphDur = 0.42
  private hueFrom = new THREE.Color()
  private hueTo = new THREE.Color()
  private hue = new THREE.Color()
  private floor?: THREE.InstancedMesh
  private frame?: THREE.LineLoop
  private plate?: THREE.Mesh
  private items: ItemView[] = []
  private readonly player = new Tesseract()
  private readonly playerHalo: THREE.Sprite
  private readonly shadow: THREE.Mesh
  private readonly dropLine: THREE.Line
  private readonly blockGhost: THREE.Mesh
  private blockLife = 0
  private moveFrom = new THREE.Vector3()
  private moveTo = new THREE.Vector3()
  private moveT = 1
  private bumpDir = new THREE.Vector3()
  private bumpT = 1
  private phaseFrom = 0
  private phaseTo = 0
  private phaseT = 1
  private shake = 0
  private time = 0
  private readonly cut = { value: 99 }
  private cutY = 0
  private particles: Particle[] = []
  private readonly points: THREE.Points
  private solution?: THREE.Line
  private readonly target = new THREE.Vector3()
  private readonly color = new THREE.Color()
  private readonly m = new THREE.Matrix4()

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene.add(new THREE.HemisphereLight('#f4f2ff', '#24203a', 1.5))
    const sun = new THREE.DirectionalLight('#ffffff', 1.7)
    sun.position.set(4, 10, 6)
    this.scene.add(sun)
    this.scene.add(this.root)

    const glow = makeGlowTexture()
    this.playerHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }))
    this.playerHalo.scale.setScalar(1.5)
    this.player.group.add(this.playerHalo)
    this.scene.add(this.player.group)

    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false }))
    this.shadow.rotation.x = -HALF_PI
    this.scene.add(this.shadow)
    this.dropLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]),
      new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.08, gapSize: 0.08, transparent: true, opacity: 0.5 }),
    )
    this.scene.add(this.dropLine)

    this.blockGhost = new THREE.Mesh(
      new RoundedBoxGeometry(0.9, 0.9, 0.9, 2, 0.08),
      new THREE.MeshBasicMaterial({ color: '#ff4d6d', transparent: true, opacity: 0, depthWrite: false, wireframe: false }),
    )
    this.blockGhost.renderOrder = 5
    this.scene.add(this.blockGhost)

    this.points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ size: 0.12, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: glow }),
    )
    this.points.frustumCulled = false
    this.scene.add(this.points)

    this.resize()
  }

  /** Rebuild meshes for a level and place the player at `pos` in slice pos[3]. */
  setLevel(level: Level, pos: V4, mask: number): void {
    this.level = level
    for (const child of [...this.root.children]) {
      this.root.remove(child)
      disposeTree(child)
    }
    const [nx, ny, nz] = level.size
    const n = nx * ny * nz
    this.wallFrom = new Float32Array(n)
    this.wallTo = new Float32Array(n)
    this.wallCur = new Float32Array(n)

    const wallMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.08 })
    wallMat.onBeforeCompile = shader => {
      // Screen-door transparency for walls above the player's height, so the player is never hidden.
      shader.uniforms.uCut = this.cut
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWY;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWY;\nuniform float uCut;')
        .replace('void main() {', 'void main() {\n  if (vWY > uCut) { vec2 g = mod(floor(gl_FragCoord.xy), 2.0); if (g.x + g.y != 1.0) discard; }')
    }
    this.walls = new THREE.InstancedMesh(new RoundedBoxGeometry(0.92, 0.92, 0.92, 2, 0.09), wallMat, n)
    this.walls.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.root.add(this.walls)

    const floorMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 })
    this.floor = new THREE.InstancedMesh(new THREE.BoxGeometry(0.96, 0.06, 0.96), floorMat, nx * nz)
    let f = 0
    for (let z = 0; z < nz; z += 1) for (let x = 0; x < nx; x += 1) {
      const c = this.cellPos([x, 0, z, 0])
      this.m.makeTranslation(c.x, -0.53, c.z)
      this.floor.setMatrixAt(f, this.m)
      this.floor.setColorAt(f, new THREE.Color('#ffffff'))
      f += 1
    }
    this.root.add(this.floor)

    const hw = nx / 2 + 0.06
    const hd = nz / 2 + 0.06
    this.frame = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-hw, -0.49, -hd), new THREE.Vector3(hw, -0.49, -hd), new THREE.Vector3(hw, -0.49, hd), new THREE.Vector3(-hw, -0.49, hd)]),
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 }),
    )
    this.root.add(this.frame)

    this.plate = undefined
    if (ny > 1) {
      // Translucent plate marking the player's current height.
      const g = new THREE.PlaneGeometry(nx, nz)
      g.rotateX(-HALF_PI)
      this.plate = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }))
      this.root.add(this.plate)
    }

    const glow = makeGlowTexture()
    this.items = level.items.map((p, i) => {
      const group = new THREE.Group()
      const hue = sliceColor(p[3])
      const mat = new THREE.MeshStandardMaterial({ color: hue, emissive: hue, emissiveIntensity: 1.3, roughness: 0.25, transparent: true })
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), mat)
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: hue, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
      halo.scale.setScalar(1.1)
      const rings: THREE.Mesh[] = []
      for (let r = 0; r < 3; r += 1) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.3 + r * 0.09, 0.012, 6, 40),
          new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }),
        )
        ring.renderOrder = 3
        rings.push(ring)
        group.add(ring)
      }
      group.add(core, halo)
      group.position.copy(this.cellPos(p))
      group.userData.phase = i * 1.7
      this.root.add(group)
      return { pos: p, group, core, mat, halo, rings, collected: (mask & (1 << i)) !== 0, life: (mask & (1 << i)) !== 0 ? 0 : 1 }
    })

    this.solution = undefined
    this.w = pos[3]
    this.prevW = this.w
    this.hueFrom.copy(sliceColor(this.w))
    this.hueTo.copy(this.hueFrom)
    this.hue.copy(this.hueTo)
    this.fillTargets(this.w)
    this.wallCur.set(this.wallTo)
    this.morph = 1
    this.applyWalls(1)
    this.snapPlayer(pos)
    this.frameCamera()
  }

  /** World position of a grid cell (W is not spatial). */
  cellPos(p: V4, out = new THREE.Vector3()): THREE.Vector3 {
    const [nx, , nz] = this.level.size
    return out.set(p[0] - (nx - 1) / 2, p[1], p[2] - (nz - 1) / 2)
  }

  snapPlayer(p: V4): void {
    this.cellPos(p, this.moveTo)
    this.moveFrom.copy(this.moveTo)
    this.moveT = 1
    this.bumpT = 1
    this.cutY = p[1]
    if (p[3] !== this.w) this.setSlice(p[3], 0, false)
  }

  movePlayer(to: V4): void {
    this.moveFrom.copy(this.currentPlayerPos())
    this.cellPos(to, this.moveTo)
    this.moveT = 0
  }

  bump(from: V4, to: V4): void {
    this.cellPos(to, this.bumpDir).sub(this.cellPos(from)).normalize()
    this.bumpT = 0
    this.shake = Math.max(this.shake, 0.06)
  }

  /** Change the displayed slice. `dir` (±1) drives the tesseract rotation direction. */
  setSlice(w: number, dir: number, animate = true): void {
    this.hueFrom.copy(this.hue)
    this.hueTo.copy(sliceColor(w))
    this.prevW = this.w
    this.w = w
    this.wallFrom.set(this.wallCur)
    this.fillTargets(w)
    this.morph = animate ? 0 : 1
    if (!animate) {
      this.wallCur.set(this.wallTo)
      this.hueFrom.copy(this.hueTo)
      this.applyWalls(1)
    }
    if (dir !== 0) {
      this.phaseFrom = this.player.xw
      this.phaseTo = this.phaseFrom + dir * HALF_PI
      this.phaseT = 0
    }
  }

  /** W move blocked: flash the wall that exists at the player's position in the target slice. */
  blockedPhase(at: V4, targetW: number): void {
    this.cellPos(at, this.blockGhost.position)
    ;(this.blockGhost.material as THREE.MeshBasicMaterial).color.copy(wallColor(targetW)).lerp(new THREE.Color('#ff3355'), 0.35)
    this.blockLife = 1
    this.shake = Math.max(this.shake, 0.08)
    this.phaseFrom = this.player.xw
    this.phaseTo = this.player.xw
    this.phaseT = 0
  }

  collect(i: number): void {
    const it = this.items[i]
    if (!it || it.collected) return
    it.collected = true
    const hue = sliceColor(it.pos[3])
    for (let k = 0; k < 40; k += 1) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(1.2 + Math.random() * 2.2)
      this.particles.push({ p: it.group.position.clone(), v, life: 0, max: 0.5 + Math.random() * 0.5, color: hue.clone().lerp(new THREE.Color('#ffffff'), Math.random() * 0.5) })
    }
    this.shake = Math.max(this.shake, 0.05)
  }

  /** Sync collected flags after undo/restart. */
  setCollected(mask: number): void {
    this.items.forEach((it, i) => {
      const c = (mask & (1 << i)) !== 0
      if (!c && it.collected) it.life = 1
      it.collected = c
      if (c) it.life = Math.min(it.life, 0)
    })
  }

  celebrate(): void {
    const p = this.currentPlayerPos()
    for (let k = 0; k < 90; k += 1) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 3)
      this.particles.push({ p: p.clone(), v, life: 0, max: 0.8 + Math.random() * 0.8, color: sliceColor(Math.floor(Math.random() * 5)) })
    }
  }

  showSolution(path: V4[] | null): void {
    if (this.solution) {
      this.root.remove(this.solution)
      disposeTree(this.solution)
      this.solution = undefined
    }
    if (!path) return
    const pts = path.map(p => this.cellPos(p).add(new THREE.Vector3(0, -0.3 + p[3] * 0.06, 0)))
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const colors = new Float32Array(path.length * 3)
    path.forEach((p, i) => sliceColor(p[3]).toArray(colors, i * 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.solution = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }))
    this.solution.renderOrder = 10
    this.root.add(this.solution)
  }

  /** Index 0..3 of the snapped camera yaw; used for camera-relative controls and the minimaps. */
  get yawIndex(): number {
    return (((Math.round(this.yaw / HALF_PI) % 4) + 4) % 4)
  }

  rotateStep(dir: number): void {
    this.yawTarget = (Math.round(this.yaw / HALF_PI) + dir) * HALF_PI
  }

  private yawTarget = 0

  dragYaw(dx: number, dy: number): void {
    this.yaw += dx
    this.yawTarget = this.yaw
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, 0.55, 1.35)
  }

  endDrag(): void {
    this.yawTarget = Math.round(this.yaw / HALF_PI) * HALF_PI
  }

  zoomBy(f: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom * f, 0.6, 1.6)
  }

  resize(): void {
    const canvas = this.renderer.domElement
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    if (this.level) this.frameCamera()
  }

  private baseDistance = 10
  private readonly fitCam = new THREE.PerspectiveCamera()
  private readonly corner = new THREE.Vector3()

  /** Initial guess; refined each frame by `fit()`. */
  private frameCamera(): void {
    const [nx, ny, nz] = this.level.size
    const radius = Math.hypot(nx, nz) / 2 + ny * 0.35 + 0.4
    const vfov = THREE.MathUtils.degToRad(this.camera.fov) / 2
    const hfov = Math.atan(Math.tan(vfov) * this.camera.aspect)
    this.baseDistance = radius / Math.sin(Math.min(vfov, hfov))
    this.fit(this.yawTarget, true)
  }

  private placeCamera(cam: THREE.PerspectiveCamera, yaw: number, dist: number): void {
    const horiz = Math.cos(this.pitch) * dist
    cam.position.set(this.target.x + Math.sin(yaw) * horiz, this.target.y + Math.sin(this.pitch) * dist, this.target.z + Math.cos(yaw) * horiz)
    cam.lookAt(this.target)
  }

  /** Adjust distance so the slice's bounding box fills ~88 % of the view at the snapped yaw. */
  private fit(yaw: number, snap: boolean): void {
    const [nx, ny, nz] = this.level.size
    const cam = this.fitCam
    cam.fov = this.camera.fov
    cam.aspect = this.camera.aspect
    cam.near = 0.1
    cam.far = 200
    cam.updateProjectionMatrix()
    this.target.set(0, (ny - 1) * 0.45, 0)
    let d = this.baseDistance
    for (let it = 0; it < (snap ? 6 : 1); it += 1) {
      this.placeCamera(cam, yaw, d)
      cam.updateMatrixWorld()
      let m = 0
      for (let i = 0; i < 8; i += 1) {
        this.corner.set(i & 1 ? nx / 2 : -nx / 2, i & 2 ? ny - 0.5 : -0.55, i & 4 ? nz / 2 : -nz / 2).project(cam)
        m = Math.max(m, Math.abs(this.corner.x), Math.abs(this.corner.y))
      }
      const want = d * (m / 0.88)
      d = snap ? want : THREE.MathUtils.lerp(d, want, 0.15)
    }
    this.baseDistance = d
  }

  private fillTargets(w: number): void {
    const [nx, ny, nz] = this.level.size
    let i = 0
    for (let y = 0; y < ny; y += 1) for (let z = 0; z < nz; z += 1) for (let x = 0; x < nx; x += 1) {
      this.wallTo[i] = this.level.walls[index(this.level.size, [x, y, z, w])] ? 1 : 0
      i += 1
    }
  }

  private applyWalls(k: number): void {
    if (!this.walls) return
    const [nx, ny, nz] = this.level.size
    const base = wallColor(this.w)
    const from = wallColor(this.prevW)
    const mixed = from.clone().lerp(base, easeInOut(k))
    let i = 0
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    const q = new THREE.Quaternion()
    for (let y = 0; y < ny; y += 1) for (let z = 0; z < nz; z += 1) for (let x = 0; x < nx; x += 1) {
      const a = this.wallFrom[i]
      const b = this.wallTo[i]
      // Staggered morph: cells start at slightly different times for an organic cross-section sweep.
      const delay = ((x * 7 + z * 13 + y * 5) % 9) / 9 * 0.35
      const t = THREE.MathUtils.clamp((k - delay) / (1 - 0.35), 0, 1)
      const v = a + (b - a) * easeInOut(t)
      this.wallCur[i] = v
      this.cellPos([x, y, z, 0], p)
      const sc = Math.max(v, 0.0001)
      s.set(sc, sc, sc)
      this.m.compose(p, q, s)
      this.walls.setMatrixAt(i, this.m)
      const shade = 0.9 + y * 0.12
      this.color.copy(mixed).multiplyScalar(shade)
      this.walls.setColorAt(i, this.color)
      i += 1
    }
    this.walls.instanceMatrix.needsUpdate = true
    if (this.walls.instanceColor) this.walls.instanceColor.needsUpdate = true
  }

  private currentPlayerPos(out = new THREE.Vector3()): THREE.Vector3 {
    const t = easeOut(this.moveT)
    out.lerpVectors(this.moveFrom, this.moveTo, t)
    out.y += Math.sin(Math.PI * this.moveT) * 0.12
    if (this.bumpT < 1) out.addScaledVector(this.bumpDir, Math.sin(Math.PI * this.bumpT) * 0.18)
    return out
  }

  update(dt: number): void {
    this.time += dt
    if (!this.level) return
    this.moveT = Math.min(1, this.moveT + dt / 0.14)
    this.bumpT = Math.min(1, this.bumpT + dt / 0.18)

    if (this.morph < 1) {
      this.morph = Math.min(1, this.morph + dt / this.morphDur)
      this.applyWalls(this.morph)
    }
    this.hue.lerpColors(this.hueFrom, this.hueTo, easeInOut(this.morph))
    if (this.floor) {
      const fc = floorColor(this.w)
      ;(this.floor.material as THREE.MeshStandardMaterial).color.copy(fc).lerp(this.hue, 0.08 * (1 - this.morph))
    }
    if (this.frame) (this.frame.material as THREE.LineBasicMaterial).color.copy(this.hue)
    if (this.plate) {
      ;(this.plate.material as THREE.MeshBasicMaterial).color.copy(this.hue)
    }

    // Player
    const pp = this.currentPlayerPos()
    this.player.group.position.copy(pp)
    if (this.phaseT < 1) {
      this.phaseT = Math.min(1, this.phaseT + dt / 0.45)
      this.player.xw = this.phaseFrom + (this.phaseTo - this.phaseFrom) * easeInOut(this.phaseT)
    }
    this.player.yw += dt * 0.35
    this.player.xz += dt * 0.25
    const pulse = this.phaseT < 1 ? Math.sin(Math.PI * this.phaseT) : 0
    this.player.scale = 0.24 * (1 + pulse * 0.25)
    this.player.setTint(this.hue)
    this.player.update()
    ;(this.playerHalo.material as THREE.SpriteMaterial).color.copy(this.hue)
    ;(this.playerHalo.material as THREE.SpriteMaterial).opacity = 0.45 + pulse * 0.5

    this.cutY = THREE.MathUtils.damp(this.cutY, this.moveTo.y, 12, dt)
    this.cut.value = this.level.size[1] > 1 ? this.cutY + 0.5 : 99
    const multiY = this.level.size[1] > 1
    this.shadow.visible = multiY
    this.dropLine.visible = multiY && pp.y > 0.2
    if (multiY) {
      this.shadow.position.set(pp.x, -0.49, pp.z)
      this.dropLine.position.copy(pp)
      this.dropLine.scale.set(1, pp.y + 0.49, 1)
      this.dropLine.computeLineDistances()
      if (this.plate) this.plate.position.set(0, this.cutY - 0.47, 0)
    }

    if (this.blockLife > 0) {
      this.blockLife = Math.max(0, this.blockLife - dt / 0.7)
      ;(this.blockGhost.material as THREE.MeshBasicMaterial).opacity = Math.sin(this.blockLife * Math.PI) * 0.55
      this.blockGhost.scale.setScalar(0.9 + (1 - this.blockLife) * 0.25)
    }
    this.blockGhost.visible = this.blockLife > 0

    // Cores: solid in this slice; ghosts (wireframe + rings, one ring per slice of distance) elsewhere.
    for (const it of this.items) {
      if (it.collected) it.life = Math.max(0, it.life - dt / 0.25)
      const dw = it.pos[3] - this.w
      const here = dw === 0
      const vis = it.life
      it.group.visible = vis > 0.001
      if (!it.group.visible) continue
      const ph = it.group.userData.phase as number
      it.core.rotation.y = this.time * 1.4 + ph
      it.core.position.y = Math.sin(this.time * 2 + ph) * 0.06
      it.mat.wireframe = !here
      it.mat.opacity = (here ? 1 : 0.55) * vis
      it.mat.depthTest = here
      it.mat.emissiveIntensity = here ? 1.4 : 0.8
      const sc = (here ? 1 : 0.8) * (it.collected ? 1 + (1 - vis) * 1.5 : 1)
      it.core.scale.setScalar(sc)
      ;(it.halo.material as THREE.SpriteMaterial).opacity = (here ? 0.85 : 0.22) * vis
      it.halo.material.depthTest = here
      it.halo.scale.setScalar(here ? 1.2 + Math.sin(this.time * 3 + ph) * 0.08 : 0.8)
      it.rings.forEach((ring, r) => {
        ring.visible = !here && r < Math.abs(dw)
        ring.rotation.set(HALF_PI + Math.sin(this.time + r) * 0.3, this.time * (0.8 + r * 0.3) * Math.sign(dw || 1), 0)
      })
    }

    // Particles
    this.particles = this.particles.filter(p => (p.life += dt) < p.max)
    const pos = new Float32Array(this.particles.length * 3)
    const col = new Float32Array(this.particles.length * 3)
    this.particles.forEach((p, i) => {
      p.v.y -= dt * 3
      p.v.multiplyScalar(1 - dt * 1.5)
      p.p.addScaledVector(p.v, dt)
      p.p.toArray(pos, i * 3)
      this.color.copy(p.color).multiplyScalar(1 - p.life / p.max)
      this.color.toArray(col, i * 3)
    })
    this.points.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.points.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3))

    // Camera
    if (!this.dragging) this.yaw = THREE.MathUtils.damp(this.yaw, this.yawTarget, 10, dt)
    this.shake = Math.max(0, this.shake - dt * 0.6)
    const dist = this.baseDistance * this.zoom
    if (this.title) {
      this.yaw += dt * 0.12
      this.yawTarget = this.yaw
    }
    this.fit(this.yawTarget, false)
    this.placeCamera(this.camera, this.yaw, dist)
    if (this.shake > 0) this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake))
    this.renderer.render(this.scene, this.camera)
  }

  /** Current slice hue (used by the DOM layer for background tinting). */
  get currentHue(): THREE.Color {
    return this.hue
  }
}

function disposeTree(obj: THREE.Object3D): void {
  obj.traverse(o => {
    const m = o as THREE.Mesh
    m.geometry?.dispose()
    const mat = m.material
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) x.dispose()
  })
}

let glowTex: THREE.Texture | null = null
function makeGlowTexture(): THREE.Texture {
  if (glowTex) return glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  glowTex = new THREE.CanvasTexture(c)
  glowTex.colorSpace = THREE.SRGBColorSpace
  return glowTex
}
