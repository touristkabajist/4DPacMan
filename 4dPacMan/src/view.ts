import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { isSurface, sliceObstacle, type Shape, type Vec4 } from './obstacles'
import { apply, lerpRotation, mul, orthonormalize, planeRotation, preset, type Mat4, type Preset } from './rot4'
import { MAX_EXTENT, type V4 } from './space'

export const AXIS_COLORS = ['#ff5a5f', '#4fe08a', '#4aa3ff', '#ffc53d']
export const PLAYER_COLOR = '#ffffff'
export const TARGET_COLOR = '#ff6bd6'
/** Obstacles: matte, cool slate glass with crisp pale edges — angular and unlit, unlike the glowing round targets. */
export const OBSTACLE_COLOR = '#7d88b8'
export const OBSTACLE_EDGE = '#dfe4ff'

export type LabelMode = 'keyboard' | 'touch'
/** Key for −/+ along each axis (keyboard mode). */
export const AXIS_KEYS: [string, string][] = [['A', 'D'], ['S', 'W'], ['Q', 'E'], ['F', 'R']]

/**
 * The box is always drawn with half-size HALF world units, whatever the level's extent: one lattice
 * step is HALF / extent. Balls shrink more slowly than the lattice (see ballScale) so big maps stay readable.
 */
const HALF = 3
const ballScale = (extent: number) => Math.min(1, (HALF / extent) ** 0.27)
/** On large maps every MAJOR-th step gets a slightly larger tick so distances stay countable. */
const MAJOR = 4
/** Guide "near" radius: Euclidean distance (lattice steps) to the nearest target. */
export const GUIDE_NEAR = 6

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
/** Unit box corners (±1); multiplied by the extent when drawn. */
const BOX_VERTS: number[][] = []
for (let i = 0; i < 16; i += 1) BOX_VERTS.push([0, 1, 2, 3].map(b => (i & (1 << b) ? 1 : -1)))
const BOX_EDGES: [number, number, number][] = []
for (let i = 0; i < 16; i += 1) for (let b = 0; b < 4; b += 1) { const j = i ^ (1 << b); if (j > i) BOX_EDGES.push([i, j, b]) }

/** Polytopes: convex slice mesh + edges. Surfaces: `mesh` is an InstancedMesh of slice blobs. */
type ObstacleView = { o: Shape; mesh: THREE.Mesh; edges: THREE.LineSegments; flash: number }
type TargetView = { mesh: THREE.Mesh; halo: THREE.Sprite; life: number; collected: boolean; phase: number }
type Particle = { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; color: THREE.Color }

/**
 * Renders the 4D lattice: world point p → view rotation M → (x′, y′, z′) drawn in 3D, w′ shown as
 * size (nearer in w′ = larger). The camera orbits freely (OrbitControls); a second drag mode rotates
 * the 4D view itself in the plane (screen-direction, w′), so hidden structure swings into sight.
 */
export class View {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200)
  readonly controls: OrbitControls
  /** Current 4D view rotation. */
  M: Mat4 = preset('oblique')
  /** When true, one-finger / left drag rotates in 4D instead of orbiting. */
  drag4D = false
  autoSpin = false
  showGuide = true
  /** 'near': the route line appears only within GUIDE_NEAR (Euclidean, lattice steps) of the target. */
  guideMode: 'near' | 'always' = 'near'
  showLabels = true
  labelMode: LabelMode = 'keyboard'
  /** Gap in CSS px between the player's rim and the key labels. */
  labelGap = 26
  onUserRotate4D: () => void = () => {}

  private tweenFrom: Mat4 | null = null
  private tweenTo: Mat4 | null = null
  private tweenT = 1
  /** Lattice half-size of the current level, world units per lattice step, and ball size factor. */
  private extent = MAX_EXTENT
  private unit = HALF / MAX_EXTENT
  private ballS = ballScale(MAX_EXTENT)
  private pos: V4 = [0, 0, 0, 0]
  private prevPos: V4 = [0, 0, 0, 0]
  private moveT = 1
  private bump: { axis: number; dir: number; t: number } | null = null
  private targets: V4[] = []
  private targetViews: TargetView[] = []
  private nearest = -1
  private time = 0
  private particles: Particle[] = []

  private readonly box: THREE.LineSegments
  private readonly cross: THREE.LineSegments
  private readonly ticks: THREE.InstancedMesh
  private readonly labels: THREE.Sprite[] = []
  private readonly player: THREE.Mesh
  private readonly playerHalo: THREE.Sprite
  private readonly ring: THREE.Sprite
  /**
   * Guide route: a thick, lightened, flowing dashed line over a dark outline, so it stays visible where
   * it runs along the same-coloured axis line through the player.
   */
  private readonly guide: LineSegments2
  private readonly guideOutline: LineSegments2
  private guideKey = ''
  /** Obstacles: 3D slice (solid + edges) through the player, plus a faint 4D wireframe "ghost". */
  private obstacleViews: ObstacleView[] = []
  /** Ghost wireframe endpoints (4D), pairs. */
  private ghostPts: Vec4[] = []
  private readonly blobGeo = new THREE.SphereGeometry(1, 14, 10)
  private readonly ghost: THREE.LineSegments
  private readonly sliceMat = new THREE.MeshStandardMaterial({
    color: OBSTACLE_COLOR, roughness: 0.95, metalness: 0, flatShading: true,
    transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1,
  })
  private readonly sliceEdgeMat = new THREE.LineBasicMaterial({ color: OBSTACLE_EDGE, transparent: true, opacity: 0.9 })
  private sliceKey = ''
  private guidePts: V4[] = []
  private blockedMask = 0
  private readonly points: THREE.Points
  private readonly group = new THREE.Group()
  private readonly tmp = [0, 0, 0, 0]
  private readonly m4 = new THREE.Matrix4()
  private readonly v3 = new THREE.Vector3()
  private readonly glow = glowTexture()

  constructor(canvas: HTMLCanvasElement, private readonly gizmo: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#30304a', 1.6))
    const sun = new THREE.DirectionalLight('#ffffff', 1.6)
    sun.position.set(5, 8, 6)
    this.scene.add(sun, this.group)

    // 4D drag handler must be registered before OrbitControls so it can veto the orbit.
    this.bind4DDrag(canvas)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.09
    this.controls.enablePan = false
    this.controls.rotateSpeed = 0.9
    this.controls.minDistance = 2
    this.controls.maxDistance = 45
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: null as unknown as THREE.MOUSE }
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }
    this.camera.position.set(9, 7, 13)

    // Boundary of the space: the 32 edges of the 4D box, coloured by the axis each edge runs along.
    const boxGeo = new THREE.BufferGeometry()
    boxGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOX_EDGES.length * 6), 3))
    const boxCol = new Float32Array(BOX_EDGES.length * 6)
    BOX_EDGES.forEach(([, , axis], i) => {
      const c = new THREE.Color(AXIS_COLORS[axis]).multiplyScalar(0.55)
      c.toArray(boxCol, i * 6)
      c.toArray(boxCol, i * 6 + 3)
    })
    boxGeo.setAttribute('color', new THREE.BufferAttribute(boxCol, 3))
    this.box = new THREE.LineSegments(boxGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45 }))
    this.box.frustumCulled = false
    this.group.add(this.box)

    // Crosshair: the four axis lines through the player, with a tick at every lattice step.
    const crossGeo = new THREE.BufferGeometry()
    crossGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 6), 3))
    const crossCol = new Float32Array(4 * 6)
    for (let a = 0; a < 4; a += 1) {
      new THREE.Color(AXIS_COLORS[a]).toArray(crossCol, a * 6)
      new THREE.Color(AXIS_COLORS[a]).toArray(crossCol, a * 6 + 3)
    }
    crossGeo.setAttribute('color', new THREE.BufferAttribute(crossCol, 3))
    this.cross = new THREE.LineSegments(crossGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7 }))
    this.cross.frustumCulled = false
    this.group.add(this.cross)
    // Ticks are deliberately faint: small, semi-transparent dots. Allocated for the largest map.
    const maxSteps = 2 * MAX_EXTENT + 1
    this.ticks = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.035, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.32, depthWrite: false }),
      4 * maxSteps,
    )
    for (let i = 0; i < 4 * maxSteps; i += 1) this.ticks.setColorAt(i, new THREE.Color('#ffffff'))
    this.ticks.frustumCulled = false
    this.group.add(this.ticks)

    for (let i = 0; i < 8; i += 1) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }))
      s.renderOrder = 20
      this.labels.push(s)
      this.group.add(s)
    }
    this.setLabelMode('keyboard')

    this.player = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 32, 20),
      new THREE.MeshStandardMaterial({ color: PLAYER_COLOR, emissive: '#bfe6ff', emissiveIntensity: 0.6, roughness: 0.25 }),
    )
    this.playerHalo = this.haloSprite('#cfe9ff', 1.5, 0.5)
    this.player.add(this.playerHalo)
    this.group.add(this.player)

    this.ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: TARGET_COLOR, transparent: true, depthWrite: false, depthTest: false }))
    this.ring.renderOrder = 15
    this.group.add(this.ring)

    const guideGeo = new LineSegmentsGeometry()
    this.guideOutline = new LineSegments2(
      guideGeo,
      new LineMaterial({ color: '#05060f', linewidth: 7, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }),
    )
    this.guide = new LineSegments2(
      guideGeo,
      new LineMaterial({ vertexColors: true, linewidth: 3.5, dashed: true, dashSize: 0.14, gapSize: 0.09, transparent: true, depthTest: false, depthWrite: false }),
    )
    this.guideOutline.renderOrder = 11
    this.guide.renderOrder = 12
    this.guide.frustumCulled = this.guideOutline.frustumCulled = false
    this.group.add(this.guideOutline, this.guide)

    this.ghost = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: OBSTACLE_EDGE, transparent: true, opacity: 0.13, depthWrite: false }),
    )
    this.ghost.frustumCulled = false
    this.group.add(this.ghost)

    this.points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ size: 0.16, map: this.glow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    this.points.frustumCulled = false
    this.group.add(this.points)
    this.resize()
  }

  private haloSprite(color: string, scale: number, opacity: number): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }))
    s.scale.setScalar(scale)
    return s
  }

  setLabelMode(mode: LabelMode): void {
    this.labelMode = mode
    for (let a = 0; a < 4; a += 1) for (let d = 0; d < 2; d += 1) {
      const name = ['X', 'Y', 'Z', 'W'][a]
      const text = mode === 'keyboard' ? AXIS_KEYS[a][d] : `${name}${d ? '+' : '−'}`
      const mat = this.labels[a * 2 + d].material
      mat.map?.dispose()
      mat.map = labelTexture(text, AXIS_COLORS[a])
      mat.needsUpdate = true
    }
  }

  // ── Round state ──────────────────────────────────────────────────────
  setRound(start: V4, targets: V4[], extent: number, obstacles: Shape[] = []): void {
    for (const ov of this.obstacleViews) {
      this.group.remove(ov.mesh, ov.edges)
      if (!isSurface(ov.o)) ov.mesh.geometry.dispose()
      else (ov.mesh as THREE.InstancedMesh).dispose()
      ov.edges.geometry.dispose()
      ;(ov.mesh.material as THREE.Material).dispose()
      ;(ov.edges.material as THREE.Material).dispose()
    }
    this.obstacleViews = obstacles.map(o => {
      // Curved slices: overlapping matte blobs read as a solid tube; opaque so the overlaps don't stack.
      const mesh = isSurface(o)
        ? new THREE.InstancedMesh(this.blobGeo, new THREE.MeshStandardMaterial({ color: OBSTACLE_COLOR, roughness: 0.95, metalness: 0, transparent: true, opacity: 0.9 }), o.samples.length)
        : new THREE.Mesh(new THREE.BufferGeometry(), this.sliceMat.clone())
      if (isSurface(o)) (mesh as THREE.InstancedMesh).count = 0
      const edges = new THREE.LineSegments(new THREE.BufferGeometry(), this.sliceEdgeMat.clone())
      mesh.renderOrder = 5
      edges.renderOrder = 6
      mesh.frustumCulled = edges.frustumCulled = false
      this.group.add(mesh, edges)
      return { o, mesh, edges, flash: 0 }
    })
    this.ghostPts = obstacles.flatMap(o => (isSurface(o) ? o.ghost : o.edges.flatMap(([i, j]) => [o.verts[i], o.verts[j]])))
    this.ghost.geometry.dispose()
    this.ghost.geometry = new THREE.BufferGeometry()
    this.ghost.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.ghostPts.length * 3), 3))
    this.sliceKey = ''
    this.guidePts = []
    this.blockedMask = 0
    this.extent = extent
    this.unit = HALF / extent
    this.ballS = ballScale(extent)
    const steps = 2 * extent + 1
    this.ticks.count = 4 * steps
    for (let a = 0; a < 4; a += 1) for (let k = 0; k < steps; k += 1) this.ticks.setColorAt(a * steps + k, new THREE.Color(AXIS_COLORS[a]))
    if (this.ticks.instanceColor) this.ticks.instanceColor.needsUpdate = true
    for (const t of this.targetViews) {
      this.group.remove(t.mesh)
      t.mesh.geometry.dispose()
      ;(t.mesh.material as THREE.Material).dispose()
    }
    this.targets = targets
    this.targetViews = targets.map((_, i) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 24, 16),
        new THREE.MeshStandardMaterial({ color: TARGET_COLOR, emissive: TARGET_COLOR, emissiveIntensity: 0.8, roughness: 0.3, transparent: true }),
      )
      const halo = this.haloSprite(TARGET_COLOR, 1.1, 0.55)
      mesh.add(halo)
      this.group.add(mesh)
      return { mesh, halo, life: 1, collected: false, phase: i * 1.3 }
    })
    this.pos = [...start] as V4
    this.prevPos = [...start] as V4
    this.moveT = 1
    this.particles = []
  }

  setNearest(i: number): void {
    this.nearest = i
  }

  movePlayer(to: V4): void {
    this.prevPos = this.displayPos()
    this.pos = [...to] as V4
    this.moveT = 0
  }

  /** Shortest route (corner points, starting at the player) to the nearest target. */
  setGuide(path: V4[]): void {
    this.guidePts = path
  }

  /** Directions (bits axis*2 + (dir>0)) the player can't move in; their key labels are dimmed. */
  setBlocked(mask: number): void {
    this.blockedMask = mask
  }

  /** Briefly light up the obstacle that stopped a move. */
  flashObstacle(i: number): void {
    const ov = this.obstacleViews[i]
    if (ov) ov.flash = 1
  }

  edgeBump(axis: number, dir: number): void {
    this.bump = { axis, dir, t: 0 }
  }

  collect(i: number): void {
    const t = this.targetViews[i]
    if (!t) return
    t.collected = true
    const c = new THREE.Color(TARGET_COLOR)
    for (let k = 0; k < 36; k += 1) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(1 + Math.random() * 2.4)
      this.particles.push({ p: t.mesh.position.clone(), v, life: 0, max: 0.5 + Math.random() * 0.5, color: c.clone().lerp(new THREE.Color('#ffffff'), Math.random() * 0.6) })
    }
  }

  celebrate(): void {
    const p = this.player.position
    for (let k = 0; k < 80; k += 1) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 3)
      this.particles.push({ p: p.clone(), v, life: 0, max: 0.8 + Math.random() * 0.7, color: new THREE.Color(AXIS_COLORS[k % 4]) })
    }
  }

  // ── 4D view rotation ────────────────────────────────────────────────
  goPreset(p: Preset): void {
    this.tweenFrom = new Float64Array(this.M)
    this.tweenTo = preset(p)
    this.tweenT = 0
  }

  /** Rotate the 4D view in the plane (camera screen direction, w′). */
  rotate4D(dx: number, dy: number): void {
    this.tweenTo = null
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion)
    const w = [0, 0, 0, 1]
    let m = this.M
    if (dx) m = mul(planeRotation([right.x, right.y, right.z, 0], w, dx), m)
    if (dy) m = mul(planeRotation([up.x, up.y, up.z, 0], w, dy), m)
    this.M = orthonormalize(m)
  }

  private bind4DDrag(canvas: HTMLCanvasElement): void {
    let active = -1
    let lx = 0
    let ly = 0
    canvas.addEventListener('pointerdown', e => {
      const want = e.button === 2 || (e.button === 0 && (e.shiftKey || this.drag4D))
      if (!want || active !== -1) return
      active = e.pointerId
      lx = e.clientX
      ly = e.clientY
      this.controls.enabled = false
      canvas.setPointerCapture(e.pointerId)
    })
    canvas.addEventListener('pointermove', e => {
      if (e.pointerId !== active) return
      const dx = e.clientX - lx
      const dy = e.clientY - ly
      lx = e.clientX
      ly = e.clientY
      this.rotate4D(dx * 0.008, -dy * 0.008)
      this.onUserRotate4D()
    })
    const end = (e: PointerEvent) => {
      if (e.pointerId !== active) return
      active = -1
      this.controls.enabled = true
    }
    canvas.addEventListener('pointerup', end)
    canvas.addEventListener('pointercancel', end)
    canvas.addEventListener('contextmenu', e => e.preventDefault())
  }

  // ── Projection ───────────────────────────────────────────────────────
  /** Lattice point → world position (x′, y′, z′); returns w′ in world units. */
  private project(p: ArrayLike<number>, out = new THREE.Vector3()): number {
    const v = apply(this.M, p, this.tmp)
    const u = this.unit
    out.set(v[0] * u, v[1] * u, v[2] * u)
    return v[3] * u
  }

  private depthScale(w: number): number {
    return THREE.MathUtils.clamp(1 + w * 0.09, 0.6, 1.4)
  }

  displayPos(): V4 {
    const t = ease(this.moveT)
    const p = this.prevPos.map((v, i) => v + (this.pos[i] - v) * t) as V4
    if (this.bump) p[this.bump.axis] += this.bump.dir * Math.sin(Math.PI * this.bump.t) * ((0.25 * this.ballS) / this.unit)
    return p
  }

  resize(): void {
    const c = this.renderer.domElement
    const w = c.clientWidth || window.innerWidth
    const h = c.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    ;(this.guide.material as LineMaterial).resolution.set(w, h)
    ;(this.guideOutline.material as LineMaterial).resolution.set(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    // Keep the whole 4D box (radius 2·HALF) in frame.
    const half = THREE.MathUtils.degToRad(this.camera.fov / 2)
    const minHalf = Math.min(half, Math.atan(Math.tan(half) * this.camera.aspect))
    const dist = (HALF * 2.05) / Math.sin(minHalf)
    this.camera.position.setLength(dist)
    this.controls.update()
  }

  resetCamera(): void {
    this.camera.position.set(9, 7, 13)
    this.resize()
  }

  // ── Frame ────────────────────────────────────────────────────────────
  update(dt: number): void {
    this.time += dt
    this.moveT = Math.min(1, this.moveT + dt / 0.16)
    if (this.bump && (this.bump.t += dt / 0.2) >= 1) this.bump = null
    if (this.tweenTo && this.tweenFrom) {
      this.tweenT = Math.min(1, this.tweenT + dt / 0.7)
      this.M = lerpRotation(this.tweenFrom, this.tweenTo, ease(this.tweenT))
      if (this.tweenT >= 1) this.tweenTo = null
    } else if (this.autoSpin) {
      this.rotate4D(dt * 0.35, 0)
    }

    // Box
    const bp = this.box.geometry.getAttribute('position') as THREE.BufferAttribute
    const ex = this.extent
    BOX_EDGES.forEach(([a, b], i) => {
      this.project(BOX_VERTS[a].map(v => v * ex), this.v3)
      bp.setXYZ(i * 2, this.v3.x, this.v3.y, this.v3.z)
      this.project(BOX_VERTS[b].map(v => v * ex), this.v3)
      bp.setXYZ(i * 2 + 1, this.v3.x, this.v3.y, this.v3.z)
    })
    bp.needsUpdate = true

    // Player
    const dp = this.displayPos()
    const pw = this.project(dp, this.player.position)
    this.player.scale.setScalar(this.depthScale(pw) * this.ballS)
    ;(this.playerHalo.material as THREE.SpriteMaterial).opacity = 0.45 + Math.sin(this.time * 3) * 0.08

    // Crosshair + ticks through the player; key labels a fixed pixel distance from the player.
    const cp = this.cross.geometry.getAttribute('position') as THREE.BufferAttribute
    const E = this.extent
    const steps = 2 * E + 1
    const major = E >= 8
    const q = [...dp]
    // Screen-space frame for the labels: player position (NDC) and its on-screen radius in px.
    this.camera.updateMatrixWorld()
    const cvs = this.renderer.domElement
    const W = cvs.clientWidth || 1
    const H = cvs.clientHeight || 1
    const P = this.player.position
    const p0 = P.clone().project(this.camera)
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
    const rimNdc = P.clone().addScaledVector(right, 0.26 * this.player.scale.x).project(this.camera)
    const touch = this.labelMode === 'touch'
    const R = Math.abs(rimNdc.x - p0.x) * (W / 2) + this.labelGap + (touch ? 4 : 0)
    const camInv = this.camera.quaternion.clone().invert()
    // Circle diameter in CSS px. Non-attenuated sprites span scale / (2·tan(fov/2)) of the viewport height.
    const px = touch ? 18 : 16
    const sh = (px * 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / Math.max(200, H)
    for (let a = 0; a < 4; a += 1) {
      const lo = [...dp]
      const hi = [...dp]
      lo[a] = -E
      hi[a] = E
      this.project(lo, this.v3)
      cp.setXYZ(a * 2, this.v3.x, this.v3.y, this.v3.z)
      this.project(hi, this.v3)
      cp.setXYZ(a * 2 + 1, this.v3.x, this.v3.y, this.v3.z)
      for (let k = 0; k < steps; k += 1) {
        q.splice(0, 4, ...dp)
        q[a] = k - E
        const w = this.project(q, this.v3)
        const big = major && (k - E) % MAJOR === 0
        const s = this.depthScale(w) * this.ballS * (major ? (big ? 1 : 0.6) : 0.8)
        this.m4.makeScale(s, s, s).setPosition(this.v3)
        this.ticks.setMatrixAt(a * steps + k, this.m4)
      }
      // Axis direction in world space. Labels fade when the axis is foreshortened in 4D (nearly along
      // w′) or points at the camera (nearly along the view ray).
      const e = [0, 0, 0, 0]
      e[a] = 1
      const dir = new THREE.Vector3()
      this.project(e, dir)
      const len = dir.length() / this.unit
      const dc = dir.clone().applyQuaternion(camInv)
      const onScreen = Math.hypot(dc.x, dc.y) / Math.max(dir.length(), 1e-9)
      const fade = THREE.MathUtils.clamp((len - 0.18) / 0.3, 0, 1) * THREE.MathUtils.clamp((onScreen - 0.15) / 0.25, 0, 1)
      // On-screen unit direction of the axis (px space).
      const p1 = P.clone().addScaledVector(dir, 0.5 / Math.max(dir.length(), 1e-9)).project(this.camera)
      let ux = (p1.x - p0.x) * W
      let uy = (p1.y - p0.y) * H
      const ul = Math.hypot(ux, uy) || 1
      ux /= ul
      uy /= ul
      for (let d = 0; d < 2; d += 1) {
        const lab = this.labels[a * 2 + d]
        const sign = d ? 1 : -1
        lab.position.set(p0.x + (sign * ux * R * 2) / W, p0.y + (sign * uy * R * 2) / H, p0.z).unproject(this.camera)
        lab.scale.set(sh, sh, 1)
        // Hidden when that direction is blocked by the boundary (the player is already at the end).
        const atEdge = this.pos[a] === sign * E
        // Blocked by an obstacle: label stays (so the player sees the direction exists) but greyed.
        const obstructed = !atEdge && (this.blockedMask & (1 << (a * 2 + d))) !== 0
        lab.material.color.set(obstructed ? '#5a5d70' : '#ffffff')
        const o = this.showLabels && !atEdge ? fade * (obstructed ? 0.7 : 0.92) : 0
        lab.material.opacity = o
        lab.visible = o > 0.01
      }
    }
    cp.needsUpdate = true
    this.ticks.instanceMatrix.needsUpdate = true

    this.updateObstacles(dt, dp)

    // Targets
    this.targetViews.forEach((t, i) => {
      if (t.collected) t.life = Math.max(0, t.life - dt / 0.25)
      t.mesh.visible = t.life > 0.001
      if (!t.mesh.visible) return
      const w = this.project(this.targets[i], t.mesh.position)
      const pulse = 1 + Math.sin(this.time * 2.4 + t.phase) * 0.06
      t.mesh.scale.setScalar(this.depthScale(w) * this.ballS * pulse * (t.collected ? 1 + (1 - t.life) : 1))
      ;(t.mesh.material as THREE.MeshStandardMaterial).opacity = t.life
      ;(t.halo.material as THREE.SpriteMaterial).opacity = 0.5 * t.life
    })

    // Nearest-target ring + guide path (one coloured segment per axis: how far to go along each).
    const nt = this.nearest >= 0 ? this.targetViews[this.nearest] : null
    this.ring.visible = !!nt && this.showGuide
    const tgt = this.nearest >= 0 ? this.targets[this.nearest] : null
    const near = !!tgt && Math.hypot(...tgt.map((v, i) => v - this.pos[i])) <= GUIDE_NEAR
    this.guide.visible = this.guideOutline.visible = !!nt && this.showGuide && this.guidePts.length > 1 && (this.guideMode === 'always' || near)
    if (nt && this.showGuide) {
      this.ring.position.copy(nt.mesh.position)
      this.ring.scale.setScalar(0.85 * nt.mesh.scale.x + Math.sin(this.time * 4) * 0.05 * this.ballS)
      this.ring.material.rotation = this.time * 0.8
      // Route from the (animated) player through the path corners; one colour per axis, lightened
      // toward white so it reads apart from the axis line it may run along.
      const pos: number[] = []
      const cols: number[] = []
      let prev = this.player.position.clone()
      let prev4: number[] = [...dp]
      for (let k = 1; k < this.guidePts.length; k += 1) {
        const c4 = this.guidePts[k]
        const a = [0, 1, 2, 3].reduce((best, ax) => (Math.abs(c4[ax] - prev4[ax]) > Math.abs(c4[best] - prev4[best]) ? ax : best), 0)
        const v = new THREE.Vector3()
        this.project(c4, v)
        const c = new THREE.Color(AXIS_COLORS[a]).lerp(new THREE.Color('#ffffff'), 0.45)
        pos.push(prev.x, prev.y, prev.z, v.x, v.y, v.z)
        cols.push(c.r, c.g, c.b, c.r, c.g, c.b)
        prev = v
        prev4 = c4
      }
      // Rebuild only when the route moved (new GPU buffers each time; the old geometry is disposed).
      const key = pos.map(v => v.toFixed(3)).join(',')
      if (key !== this.guideKey) {
        this.guideKey = key
        const old = this.guide.geometry
        const g = new LineSegmentsGeometry()
        g.setPositions(pos)
        g.setColors(cols)
        this.guide.geometry = g
        this.guideOutline.geometry = g
        this.guide.computeLineDistances()
        old.dispose()
      }
      // Dashes flow from the player toward the target.
      ;(this.guide.material as LineMaterial).dashOffset = -this.time * 0.35
    }

    // Particles
    this.particles = this.particles.filter(p => (p.life += dt) < p.max)
    const pos = new Float32Array(this.particles.length * 3)
    const col = new Float32Array(this.particles.length * 3)
    this.particles.forEach((p, i) => {
      p.v.multiplyScalar(1 - dt * 2)
      p.p.addScaledVector(p.v, dt)
      p.p.toArray(pos, i * 3)
      p.color.clone().multiplyScalar(1 - p.life / p.max).toArray(col, i * 3)
    })
    this.points.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.points.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3))

    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    this.drawGizmo()
  }

  /**
   * Obstacles. The 3D slice is the obstacle ∩ the hyperplane through the player perpendicular to the
   * hidden view direction w′ (row 3 of M). Every slice point has the player's w′, so its (x′, y′, z′)
   * are a true 3D cross-section drawn exactly where the player is. With a "hide" preset this is the
   * classic slice at the player's hidden coordinate. The ghost wireframe shows the whole 4D shape.
   */
  private updateObstacles(dt: number, dp: V4): void {
    if (!this.obstacleViews.length) {
      this.ghost.visible = false
      return
    }
    this.ghost.visible = true
    const gp = this.ghost.geometry.getAttribute('position') as THREE.BufferAttribute
    this.ghostPts.forEach((p, k) => {
      this.project(p, this.v3)
      gp.setXYZ(k, this.v3.x, this.v3.y, this.v3.z)
    })
    gp.needsUpdate = true

    const n = [this.M[12], this.M[13], this.M[14], this.M[15]]
    const c = n[0] * dp[0] + n[1] * dp[1] + n[2] * dp[2] + n[3] * dp[3]
    const key = Array.from(this.M, v => v.toFixed(4)).join(',') + '|' + dp.map(v => v.toFixed(3)).join(',')
    const rebuild = key !== this.sliceKey
    this.sliceKey = key
    for (const ov of this.obstacleViews) {
      const o = ov.o
      if (isSurface(o)) {
        if (rebuild) {
          // Slice of a thickened surface: every sample within `thickness` of the hyperplane contributes
          // a sphere of radius √(T² − s²) — exactly that sample ball's cross-section.
          const im = ov.mesh as THREE.InstancedMesh
          const T = o.thickness
          let cnt = 0
          for (const sp of o.samples) {
            const sd = n[0] * sp[0] + n[1] * sp[1] + n[2] * sp[2] + n[3] * sp[3] - c
            if (sd <= -T || sd >= T) continue
            const rr = Math.sqrt(T * T - sd * sd) * this.unit
            this.project(sp, this.v3)
            this.m4.makeScale(rr, rr, rr).setPosition(this.v3)
            im.setMatrixAt(cnt++, this.m4)
          }
          im.count = cnt
          im.instanceMatrix.needsUpdate = true
        }
        ov.flash = Math.max(0, ov.flash - dt / 0.5)
        const bm = ov.mesh.material as THREE.MeshStandardMaterial
        bm.emissive.set(ov.flash > 0.01 ? '#ff5a5f' : '#000000')
        bm.emissiveIntensity = ov.flash > 0.01 ? ov.flash * 0.9 : 0
        continue
      }
      if (rebuild) {
        const pts = sliceObstacle(o, n, c).map(p => {
          const v = new THREE.Vector3()
          this.project(p, v)
          return v
        })
        ov.mesh.geometry.dispose()
        ov.edges.geometry.dispose()
        let geo: THREE.BufferGeometry | null = null
        if (pts.length >= 4) {
          try {
            geo = new ConvexGeometry(pts)
            if (!geo.getAttribute('position')?.count) geo = null
          } catch {
            geo = null // Degenerate (flat) slice: skip.
          }
        }
        ov.mesh.geometry = geo ?? new THREE.BufferGeometry()
        ov.edges.geometry = geo ? new THREE.EdgesGeometry(geo, 1) : new THREE.BufferGeometry()
      }
      ov.flash = Math.max(0, ov.flash - dt / 0.5)
      const mm = ov.mesh.material as THREE.MeshStandardMaterial
      // Red flash only while bumping; otherwise strictly unlit-looking slate.
      mm.emissive.set(ov.flash > 0.01 ? '#ff5a5f' : '#000000')
      mm.emissiveIntensity = ov.flash > 0.01 ? ov.flash * 0.9 : 0
      mm.opacity = 0.42 + ov.flash * 0.3
      ;(ov.edges.material as THREE.LineBasicMaterial).color.set(ov.flash > 0.01 ? '#ffb3b5' : OBSTACLE_EDGE)
    }
  }

  /** Corner gizmo: the four world axes as seen from the camera, after the 4D rotation. */
  private drawGizmo(): void {
    const c = this.gizmo
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const size = c.clientWidth
    if (!size) return
    if (c.width !== Math.round(size * dpr)) {
      c.width = c.height = Math.round(size * dpr)
    }
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, size, size)
    const r = size * 0.36
    const cx = size / 2
    const cy = size / 2
    const inv = this.camera.quaternion.clone().invert()
    const axes = [0, 1, 2, 3].map(a => {
      const e = [0, 0, 0, 0]
      e[a] = 1
      const v = new THREE.Vector3()
      this.project(e, v)
      v.divideScalar(this.unit).applyQuaternion(inv)
      return { a, v }
    })
    axes.sort((p, q) => p.v.z - q.v.z)
    g.lineCap = 'round'
    g.beginPath()
    g.arc(cx, cy, r + 10, 0, Math.PI * 2)
    g.fillStyle = 'rgba(10,12,28,0.55)'
    g.fill()
    for (const { a, v } of axes) {
      const x = cx + v.x * r
      const y = cy - v.y * r
      const len = Math.hypot(v.x, v.y, v.z)
      g.globalAlpha = 0.35 + 0.65 * Math.min(1, len)
      g.strokeStyle = AXIS_COLORS[a]
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(cx, cy)
      g.lineTo(x, y)
      g.stroke()
      g.beginPath()
      g.arc(x, y, 8.5, 0, Math.PI * 2)
      g.fillStyle = AXIS_COLORS[a]
      g.fill()
      g.fillStyle = '#0a0c1c'
      g.font = '700 11px ui-monospace, Menlo, monospace'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('XYZW'[a], x, y + 0.5)
    }
    g.globalAlpha = 1
  }
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.3, 'rgba(255,255,255,0.4)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function ringTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.strokeStyle = '#ffffff'
  g.lineWidth = 7
  g.setLineDash([22, 12])
  g.beginPath()
  g.arc(64, 64, 52, 0, Math.PI * 2)
  g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function labelTexture(text: string, color: string): THREE.Texture {
  // Square canvas with a filled circle hugging the text; the sprite is drawn square.
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = color
  g.beginPath()
  g.arc(32, 32, 31, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#0a0c1c'
  g.font = `800 ${text.length > 1 ? 26 : 38}px ui-monospace, Menlo, monospace`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 32, 34)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}
