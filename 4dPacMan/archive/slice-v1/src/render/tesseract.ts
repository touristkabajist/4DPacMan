import * as THREE from 'three'

/**
 * The player avatar: a tesseract (4D hypercube) projected into 3D. Edges are instanced
 * cylinders, vertices instanced spheres. A step along W plays a 90° rotation in the XW plane —
 * the classic "inside-out" tesseract motion — which maps the shape onto itself, so the avatar
 * literally shows the move through the fourth dimension.
 */
const VERTS: number[][] = []
for (let i = 0; i < 16; i += 1) VERTS.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1])
const EDGES: [number, number][] = []
for (let i = 0; i < 16; i += 1) for (let b = 0; b < 4; b += 1) { const j = i ^ (1 << b); if (j > i) EDGES.push([i, j]) }

const UP = new THREE.Vector3(0, 1, 0)

export class Tesseract {
  readonly group = new THREE.Group()
  /** Rotation angles in the XW, YW, ZW and XZ planes. */
  xw = 0
  yw = 0.4
  zw = 0
  xz = 0.6
  scale = 0.24
  private readonly edges: THREE.InstancedMesh
  private readonly nodes: THREE.InstancedMesh
  private readonly edgeMat: THREE.MeshStandardMaterial
  private readonly core: THREE.Mesh
  private readonly p3 = VERTS.map(() => new THREE.Vector3())
  private readonly wDepth = new Float32Array(16)
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly v = new THREE.Vector3()
  private readonly s = new THREE.Vector3()
  private readonly color = new THREE.Color()

  constructor(radius = 0.035) {
    this.edgeMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.3 })
    this.edges = new THREE.InstancedMesh(new THREE.CylinderGeometry(radius, radius, 1, 6, 1, true), this.edgeMat, EDGES.length)
    this.nodes = new THREE.InstancedMesh(new THREE.SphereGeometry(radius * 1.9, 10, 8), this.edgeMat, VERTS.length)
    this.edges.frustumCulled = false
    this.nodes.frustumCulled = false
    this.core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.11, 1),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }),
    )
    this.group.add(this.edges, this.nodes, this.core)
  }

  setTint(c: THREE.Color): void {
    this.color.copy(c).lerp(new THREE.Color('#ffffff'), 0.55)
    this.edgeMat.color.copy(this.color)
    this.edgeMat.emissive.copy(c)
    ;(this.core.material as THREE.MeshBasicMaterial).color.copy(this.color)
  }

  update(): void {
    const { xw, yw, zw, xz } = this
    const cxw = Math.cos(xw), sxw = Math.sin(xw)
    const cyw = Math.cos(yw), syw = Math.sin(yw)
    const czw = Math.cos(zw), szw = Math.sin(zw)
    const cxz = Math.cos(xz), sxz = Math.sin(xz)
    VERTS.forEach((v0, i) => {
      let [x, y, z, w] = v0
      ;[x, w] = [x * cxw - w * sxw, x * sxw + w * cxw]
      ;[y, w] = [y * cyw - w * syw, y * syw + w * cyw]
      ;[z, w] = [z * czw - w * szw, z * szw + w * czw]
      ;[x, z] = [x * cxz - z * sxz, x * sxz + z * cxz]
      // Perspective from W: the "far" cube (w = -1) appears smaller and inside the near one.
      const k = 1 / (2.4 - w * 0.9)
      this.p3[i].set(x * k, y * k, z * k).multiplyScalar(this.scale * 3.2)
      this.wDepth[i] = w
    })
    EDGES.forEach(([a, b], i) => {
      const pa = this.p3[a]
      const pb = this.p3[b]
      this.v.subVectors(pb, pa)
      const len = this.v.length()
      this.q.setFromUnitVectors(UP, this.v.normalize())
      this.s.set(1, len, 1)
      this.m.compose(this.v.copy(pa).add(pb).multiplyScalar(0.5), this.q, this.s)
      this.edges.setMatrixAt(i, this.m)
    })
    this.q.identity()
    VERTS.forEach((_, i) => {
      const sz = 0.7 + (this.wDepth[i] + 1) * 0.3
      this.m.compose(this.p3[i], this.q, this.s.set(sz, sz, sz))
      this.nodes.setMatrixAt(i, this.m)
    })
    this.edges.instanceMatrix.needsUpdate = true
    this.nodes.instanceMatrix.needsUpdate = true
  }
}
