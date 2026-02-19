import {
  Component,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  Input,
  Output,
  EventEmitter,
  NgZone,
  inject,
  signal,
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Planet } from '../../models/planet.model';

/**
 * Stores precomputed Keplerian elements and rotation-matrix components
 * for one orbiting planet.
 */
interface PlanetObject {
  mesh: THREE.Mesh;       // visible sphere
  hitMesh: THREE.Mesh;    // invisible larger sphere — easy click/hover target
  glowMesh: THREE.Mesh;   // back-side halo child of mesh, shown on hover
  visualRadius: number;   // base geometry radius (world units) — used for min-size scaling
  speed: number;          // Δmean-anomaly per frame at speed×1
  meanAnomaly: number;    // M, increases uniformly each frame
  rotationDir: number;    // +1 prograde, -1 retrograde (Venus, Uranus)
  // Orbital shape (visual units)
  a: number;              // semi-major axis
  b: number;              // semi-minor axis = a·√(1−e²)
  e: number;              // eccentricity
  // Precomputed rotation-matrix terms (Ω = ascending node, i = inclination)
  cosNode: number;
  sinNode: number;
  cosInc: number;
  sinInc: number;
  ring?: THREE.Mesh;  // Saturn's ring (scene-level, not parented to mesh)
}

interface CometObject {
  planet: Planet;
  mesh: THREE.Mesh;
  tailGeo: THREE.BufferGeometry;
  tailLine: THREE.Line;
  hitMesh: THREE.Mesh;
  glowMesh: THREE.Mesh;
  perihelionVis: number;  // perihelion distance in visual units (tail scaling)
  speed: number;
  meanAnomaly: number;
  a: number; b: number; e: number;
  cosNode: number; sinNode: number; cosInc: number; sinInc: number;
}

/** Visual-only moon — no hitMesh, no info panel. Orbits around a parent planet. */
interface MoonObject {
  mesh: THREE.Mesh;
  orbitLine: THREE.LineLoop;
  orbitRadius: number;   // world units from planet centre
  speed: number;         // Δangle per frame (rad), negative = retrograde
  angle: number;         // current orbital angle (rad)
  cosInc: number;        // precomputed from inclination to ecliptic
  sinInc: number;
  parentPlanetObj: PlanetObject;
}

@Component({
  selector: 'app-solar-system',
  standalone: true,
  imports: [],
  templateUrl: './solar-system.html',
  styleUrl: './solar-system.scss',
})
export class SolarSystem implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @Input() planets: Planet[] = [];
  @Output() planetSelected = new EventEmitter<Planet>();
  @Output() closeInfo      = new EventEmitter<void>();

  private readonly ngZone = inject(NgZone);

  simulationSpeed = signal(0.25);
  hoveredPlanet  = signal<{ name: string; color: string } | null>(null);
  tooltipPos     = signal<{ x: number; y: number }>({ x: 0, y: 0 });

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private animationId!: number;
  private planetObjects: PlanetObject[] = [];
  private cometObjects: CometObject[] = [];
  private moonObjects:  MoonObject[]  = [];
  // Smooth camera zoom animation triggered by double-click
  private _zoomAnim?: {
    fromCam: THREE.Vector3;
    toCam: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    t: number;   // progress 0 → 1
  };
  // All hit-detection meshes (invisible, larger than visual).
  // Used for both click and hover raycasting.
  private hitMeshes: THREE.Mesh[] = [];
  private currentHoveredGlow: THREE.Mesh | null = null;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private asteroidBelt?: THREE.Points;
  private asteroidBeltMat?: THREE.PointsMaterial;
  private currentHoveredBelt = false;
  private sunMesh?: THREE.Mesh;
  private sunHitMesh?: THREE.Mesh;
  private sunVisualRadius = 0;
  private readonly _tmpVec = new THREE.Vector3();
  private _navInterval?: ReturnType<typeof setInterval>;

  // Use real J2000 eccentricities (boost = 1) so the visual orbit matches the
  // perihelion/aphelion values shown in the info panel.
  // Mercury (e=0.2056) has a clearly visible ellipse; other planets are nearly
  // circular, which is physically accurate.
  private readonly ECCENTRICITY_BOOST = 1;
  private readonly INCLINATION_BOOST  = 2;    // degrees × 2 — keeps orbits visually coplanar
  // Uniform hit-detection radius for ALL bodies (Sun + 8 planets).
  // Fixed size so tiny Mercury and large Jupiter are equally easy to click.
  private readonly HIT_RADIUS = 5;

  private readonly ASTEROID_BELT_PLANET: Planet = {
    name: 'Asteroid Belt', name_sr: 'Asteroidni pojas',
    radius: 0, distance_from_sun: 2.7, orbital_period: 0,
    rotation_period: 0, color: '#aa9966',
    description: 'Asteroidni pojas je region između orbita Marsa i Jupitera koji sadrži veliki broj asteroida, patuljastih planeta i manjih tela. Nastao je u ranom Solarnom sistemu kada je gravitacija Jupitera sprečila formiranje pune planete. Ukupna masa pojasa iznosi svega oko 4% mase Meseca.',
    satellites: 0, notable_satellites: [],
    is_star: false, is_asteroid_belt: true,
    eccentricity: 0, inclination: 0, ascending_node: 0,
  };

  private readonly OORT_CLOUD_PLANET: Planet = {
    name: 'Oort Cloud', name_sr: 'Ortov oblak',
    radius: 0, distance_from_sun: 50000, orbital_period: 0,
    rotation_period: 0, color: '#aaccff',
    description: 'Ortov oblak je hipotetička sferična ljuska koja okružuje Solarni sistem i proteže se do pola udaljenosti do najbliže zvezde. Smatra se da je izvor dugoperiodičnih kometa. Nikada nije direktno posmatran — njegovo postojanje se zaključuje iz putanja kometa.',
    satellites: 0, notable_satellites: [],
    is_star: false, is_oort_cloud: true,
    eccentricity: 0, inclination: 0, ascending_node: 0,
  };

  // Visual sizes — ~3% of each planet's orbital radius for gas giants,
  // slightly boosted for inner planets so they're visible up close.
  //   Mercury orbit ≈  13.5 u  →  r ≈ 1.5
  //   Jupiter orbit ≈ 182  u  →  r ≈ 5.5  (3%)
  //   Saturn  orbit ≈ 335  u  →  r ≈ 5.0
  private readonly VISUAL_SIZES: Record<string, number> = {
    Sun:     1.8,
    Mercury: 0.7,
    Venus:   1.1,
    Earth:   1.2,
    Mars:    0.9,
    Jupiter: 3.2,
    Saturn:  2.8,
    Uranus:  2.2,
    Neptune: 2.1,
  };

  // Real J2000 orbital elements for famous comets.
  // Eccentricity and inclination are NOT boosted — comet orbits are
  // already visually dramatic (Halley e=0.967, retrograde inc=162°).
  private readonly COMET_DEFS = [
    {
      name: 'Halley', nameSr: '1P/Halley', color: '#99ccff',
      description: 'Halleyjeva kometa je najpoznatija periodična kometa, vidljiva golim okom svaka 75–76 godina. Ima retrogradno kretanje — kruži oko Sunca suprotno od planeta. Poslednji perihelij bio je 1986. godine; sledeći se očekuje 2061.',
      a: 17.834, e: 0.96714, inc: 162.26, node: 58.42,
      period: 75.32, radius: 11, rotPeriod: 2.2,
      startFraction: 0.42,  // mean anomaly fraction 0–1 (position in orbit)
    },
    {
      name: 'Encke', nameSr: '2P/Encke', color: '#aaffcc',
      description: 'Enkejeva kometa ima najkraći poznati orbitalni period (~3.3 godine). Prolazi bliže Suncu od Merkura i izvor je Tauridnog meteorskog roja.',
      a: 2.2179, e: 0.84823, inc: 11.78, node: 334.57,
      period: 3.30, radius: 4.8, rotPeriod: 11.1,
      startFraction: 0.10,
    },
    {
      name: '67P', nameSr: '67P/Čurjumov-Gerasimenko', color: '#ffddaa',
      description: 'Kometa 67P/Čurjumov-Gerasimenko postala je svetski poznata zahvaljujući ESA-inoj misiji Rozeta (2004–2016) — prvom svemirskom brodu koji je ušao u orbitu komete i sleteo na njenu površinu.',
      a: 3.463, e: 0.641, inc: 7.04, node: 50.14,
      period: 6.44, radius: 2.5, rotPeriod: 12.4,
      startFraction: 0.25,
    },
  ] as const;

  // Moon orbital radii in visual units.
  //
  // Each planet's moon system is scaled so its innermost moon sits at
  // 1.5 × parent visual radius — just outside the planet sphere.
  // All other moons of that planet use the SAME scale factor, so their
  // relative spacings exactly match the real km distances.
  //
  // Formula per planet:  scale = (parentVisR × 1.5) / rawVis_innermost
  //   rawVis = distKm × (35 / 149_597_870)       [1 AU = 35 vis units]
  //   orbitVis = rawVis × scale
  //
  // Resulting ratios (e.g. Callisto/Io = 1882700/421800 = 4.46) are preserved.
  // Real inclinations to the ecliptic; Uranus moons ≈ 97.8°, Triton 156.8°.
  private readonly MOON_DEFS = [
    // Earth  — Moon only  (scale ×20.0)
    { name: 'Mesec',    parentName: 'Earth',   color: '#bbbbaa', orbitVis:  1.80, vr: 0.35, periodDays:  27.320, incDeg:   5.14 },
    // Mars   — inner: Phobos  (scale ×616)
    { name: 'Fobos',   parentName: 'Mars',    color: '#887766', orbitVis:  1.35, vr: 0.18, periodDays:   0.319, incDeg:  26.04 },
    { name: 'Dejmos',  parentName: 'Mars',    color: '#998877', orbitVis:  3.38, vr: 0.14, periodDays:   1.263, incDeg:  27.58 },
    // Jupiter — Galilean moons  (scale ×48.6, inner: Io)
    { name: 'Io',      parentName: 'Jupiter', color: '#ddaa44', orbitVis:  4.80, vr: 0.30, periodDays:   1.769, incDeg:   2.21 },
    { name: 'Evropa',  parentName: 'Jupiter', color: '#aaccee', orbitVis:  7.63, vr: 0.25, periodDays:   3.551, incDeg:   3.10 },
    { name: 'Ganimede',parentName: 'Jupiter', color: '#997766', orbitVis: 12.18, vr: 0.38, periodDays:   7.155, incDeg:   2.21 },
    { name: 'Kalisto', parentName: 'Jupiter', color: '#776655', orbitVis: 21.43, vr: 0.32, periodDays:  16.690, incDeg:   2.02 },
    // Saturn — inner: Enceladus  (scale ×75.4)
    { name: 'Enkelad', parentName: 'Saturn',  color: '#ddeeff', orbitVis:  4.20, vr: 0.16, periodDays:   1.370, incDeg:  28.05 },
    { name: 'Titan',   parentName: 'Saturn',  color: '#ddaa66', orbitVis: 21.56, vr: 0.34, periodDays:  15.945, incDeg:  28.06 },
    // Uranus — near-perpendicular (axial tilt 97.77°), inner: Titania  (scale ×32.4)
    { name: 'Titanija',parentName: 'Uranus',  color: '#aaaacc', orbitVis:  3.30, vr: 0.22, periodDays:   8.706, incDeg:  97.77 },
    { name: 'Oberon',  parentName: 'Uranus',  color: '#887777', orbitVis:  4.42, vr: 0.20, periodDays:  13.463, incDeg:  97.77 },
    // Neptune — Triton only, retrograde  (scale ×37.9)
    { name: 'Triton',  parentName: 'Neptune', color: '#aabbdd', orbitVis:  3.15, vr: 0.26, periodDays:   5.877, incDeg: 156.84 },
  ] as const;

  ngAfterViewInit(): void {
    this.initScene();
    this.buildSolarSystem();
    this.createAsteroidBelt();
    this.createOortCloudHitSphere();
    this.createComets();
    this.createMoons();
    this.animate();
    window.addEventListener('resize', this.onResize);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animationId);
    this.stopNav();
    window.removeEventListener('resize', this.onResize);
    const canvas = this.canvasRef.nativeElement;
    canvas.removeEventListener('click', this.onCanvasClick);
    canvas.removeEventListener('dblclick', this.onCanvasDblClick);
    canvas.removeEventListener('mousemove', this.onCanvasMouseMove);
    canvas.removeEventListener('wheel', this.onCanvasZoom);
    canvas.removeEventListener('touchstart', this.onCanvasTouchStart);
    this.controls.removeEventListener('start', this.onControlsStart);
    this.renderer.dispose();
  }

  private initScene(): void {
    const canvas = this.canvasRef.nativeElement;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000005);

    this.camera = new THREE.PerspectiveCamera(
      55,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      10000
    );
    this.camera.position.set(0, 450, 1100);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 15;
    this.controls.maxDistance = 6000;
    // Hide tooltip on any camera interaction (rotate, pan, zoom)
    this.controls.addEventListener('start', this.onControlsStart);

    // Ambient + sun point light
    this.scene.add(new THREE.AmbientLight(0x222244, 1.5));
    const sunLight = new THREE.PointLight(0xfffaf0, 3, 2000, 1.2);
    sunLight.position.set(0, 0, 0);
    this.scene.add(sunLight);

    this.createStarfield();
    // Register native DOM listeners outside Angular zone so mousemove doesn't
    // trigger full change detection on every frame. Signal updates inside the
    // handlers are wrapped with ngZone.run() to re-enter the zone only when
    // the hovered planet actually changes.
    this.ngZone.runOutsideAngular(() => {
      canvas.addEventListener('click', this.onCanvasClick);
      canvas.addEventListener('dblclick', this.onCanvasDblClick);
      canvas.addEventListener('mousemove', this.onCanvasMouseMove);
      canvas.addEventListener('wheel', this.onCanvasZoom, { passive: true });
      canvas.addEventListener('touchstart', this.onCanvasTouchStart, { passive: true });
    });
  }

  private createStarfield(): void {
    const count = 10000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Uniform random point on a sphere surface (Marsaglia / trig method)
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      // Thin shell: radius between 2400 and 2600 so the "Oort cloud"
      // looks like a sphere, not a cube, when fully zoomed out.
      const r = 2400 + Math.random() * 200;
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.4, sizeAttenuation: true });
    this.scene.add(new THREE.Points(geo, mat));
  }

  /** Create a back-side halo sphere (initially invisible) and attach it to parent. */
  private makeGlowMesh(visualRadius: number, color: THREE.Color): THREE.Mesh {
    const geo = new THREE.SphereGeometry(visualRadius * 2.0, 32, 32);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return new THREE.Mesh(geo, mat);
  }

  /** Create an invisible sphere used purely for hit detection (click + hover). */
  private makeHitMesh(_visualRadius: number, planet: Planet, glowMesh: THREE.Mesh): THREE.Mesh {
    const geo = new THREE.SphereGeometry(this.HIT_RADIUS, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = { planet, glowMesh };
    return mesh;
  }

  private buildSolarSystem(): void {
    for (const planet of this.planets) {
      const visualRadius = this.VISUAL_SIZES[planet.name] ?? 1;
      const color = new THREE.Color(planet.color);

      if (planet.is_star) {
        const geo = new THREE.SphereGeometry(visualRadius, 64, 64);
        const mat = new THREE.MeshBasicMaterial({ color });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { planet };
        this.scene.add(mesh);
        this.sunMesh = mesh;
        this.sunVisualRadius = visualRadius;

        const glowMesh = this.makeGlowMesh(visualRadius, new THREE.Color(0xffee88));
        mesh.add(glowMesh);

        const hitMesh = this.makeHitMesh(visualRadius, planet, glowMesh);
        this.scene.add(hitMesh); // Sun stays at origin — no movement needed
        this.hitMeshes.push(hitMesh);
        this.sunHitMesh = hitMesh;
        continue;
      }

      // ── Keplerian elements (visually boosted for clarity) ───────────────
      const a = this.getOrbitRadius(planet.distance_from_sun);
      const e = Math.min((planet.eccentricity ?? 0) * this.ECCENTRICITY_BOOST, 0.70);
      const b = a * Math.sqrt(1 - e * e);
      const incDeg  = (planet.inclination   ?? 0) * this.INCLINATION_BOOST;
      const incRad  = (incDeg  * Math.PI) / 180;
      const nodeRad = ((planet.ascending_node ?? 0) * Math.PI) / 180;
      const cosNode = Math.cos(nodeRad);
      const sinNode = Math.sin(nodeRad);
      const cosInc  = Math.cos(incRad);
      const sinInc  = Math.sin(incRad);

      // ── Elliptical orbit path ───────────────────────────────────────────
      this.scene.add(this.createOrbitLine(a, b, e, cosNode, sinNode, cosInc, sinInc));

      // ── Planet sphere ───────────────────────────────────────────────────
      const geo = new THREE.SphereGeometry(visualRadius, 32, 32);
      const mat = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.75,
        shininess: 40,
        specular: new THREE.Color(0x333333),
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { planet };
      this.scene.add(mesh);

      // Glow halo (child — follows mesh automatically)
      const glowMesh = this.makeGlowMesh(visualRadius, color);
      mesh.add(glowMesh);

      // Invisible hit sphere (updated in animate loop)
      const hitMesh = this.makeHitMesh(visualRadius, planet, glowMesh);
      this.scene.add(hitMesh);
      this.hitMeshes.push(hitMesh);

      const speed = (365.25 / planet.orbital_period) * 0.006;
      const startM = Math.random() * Math.PI * 2;
      // Negative rotation_period means retrograde (Venus: −243d, Uranus: −0.72d)
      const rotationDir = planet.rotation_period < 0 ? -1 : 1;

      const obj: PlanetObject = {
        mesh, hitMesh, glowMesh,
        visualRadius,
        speed, meanAnomaly: startM, rotationDir,
        a, b, e, cosNode, sinNode, cosInc, sinInc,
      };

      // Saturn's ring — added directly to scene (not parented to mesh) so it
      // doesn't inherit the planet's axial spin; position is updated each frame.
      if (planet.name === 'Saturn') {
        const ringGeo = new THREE.RingGeometry(visualRadius * 1.4, visualRadius * 2.3, 80);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xc9a96e,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.75,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2.6;
        this.scene.add(ring);
        obj.ring = ring;
      }
      const initPos = this.keplerToWorld(obj);
      mesh.position.copy(initPos);
      hitMesh.position.copy(initPos);

      this.planetObjects.push(obj);
    }
  }

  /**
   * Linear scale: 1 AU = 35 visual units.
   * Preserves real proportions between orbits.
   *   Mercury  ≈  13.5 u   |   Jupiter ≈  182 u
   *   Venus    ≈  25.3 u   |   Saturn  ≈  335 u
   *   Earth    ≈  35   u   |   Uranus  ≈  672 u
   *   Mars     ≈  53.3 u   |   Neptune ≈ 1052 u
   */
  private getOrbitRadius(distanceAU: number): number {
    return distanceAU * 35;
  }

  /**
   * Build a LineLoop tracing the full ellipse in 3D space.
   * The Sun sits at one focus of the ellipse (origin = focus).
   *
   * Parametric form (eccentric anomaly E, 0…2π):
   *   x_orb = a·(cos E − e)      ← origin = focus, not centre
   *   y_orb = b·sin E
   *
   * Then rotate from orbital plane to ecliptic:
   *   x3D =  cosΩ·x_orb − sinΩ·cosI·y_orb
   *   y3D =  sinI·y_orb                         (Three.js y = up)
   *   z3D =  sinΩ·x_orb + cosΩ·cosI·y_orb
   */
  private createOrbitLine(
    a: number, b: number, e: number,
    cosNode: number, sinNode: number, cosInc: number, sinInc: number,
    color = 0x7788bb, opacity = 0.75,
  ): THREE.LineLoop {
    const N = 256;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const E = (i / N) * Math.PI * 2;
      const xOrb = a * (Math.cos(E) - e);
      const yOrb = b * Math.sin(E);
      pts.push(new THREE.Vector3(
        cosNode * xOrb - sinNode * cosInc * yOrb,
        sinInc * yOrb,
        sinNode * xOrb + cosNode * cosInc * yOrb,
      ));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    return new THREE.LineLoop(geo, mat);
  }

  /**
   * Newton-Raphson solver for Kepler's equation: M = E − e·sin(E).
   * Uses 15 iterations for high eccentricities (comets), 5 for planets.
   * Returns the 3D world position on the orbit.
   */
  private solveKepler(
    meanAnomaly: number, a: number, b: number, e: number,
    cosNode: number, sinNode: number, cosInc: number, sinInc: number,
  ): THREE.Vector3 {
    const iters = e > 0.9 ? 15 : 5;
    let E = meanAnomaly;
    for (let i = 0; i < iters; i++) {
      E = E - (E - e * Math.sin(E) - meanAnomaly) / (1 - e * Math.cos(E));
    }
    const xOrb = a * (Math.cos(E) - e);
    const yOrb = b * Math.sin(E);
    return new THREE.Vector3(
      cosNode * xOrb - sinNode * cosInc * yOrb,
      sinInc * yOrb,
      sinNode * xOrb + cosNode * cosInc * yOrb,
    );
  }

  private keplerToWorld(obj: PlanetObject): THREE.Vector3 {
    return this.solveKepler(obj.meanAnomaly, obj.a, obj.b, obj.e,
      obj.cosNode, obj.sinNode, obj.cosInc, obj.sinInc);
  }

  private keplerCometToWorld(obj: CometObject): THREE.Vector3 {
    return this.solveKepler(obj.meanAnomaly, obj.a, obj.b, obj.e,
      obj.cosNode, obj.sinNode, obj.cosInc, obj.sinInc);
  }

  private createAsteroidBelt(): void {
    const innerRadius = this.getOrbitRadius(2.2);
    const outerRadius = this.getOrbitRadius(3.2);
    const count = 2800;

    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radialNoise = (Math.random() + Math.random()) / 2;
      const r = innerRadius + radialNoise * (outerRadius - innerRadius);
      const yScatter = (Math.random() - 0.5) * 4;

      positions[i * 3]     = Math.cos(angle) * r;
      positions[i * 3 + 1] = yScatter;
      positions[i * 3 + 2] = Math.sin(angle) * r;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x998877,
      size: 0.35,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
    });
    this.asteroidBeltMat = mat;
    this.asteroidBelt = new THREE.Points(geo, mat);
    this.scene.add(this.asteroidBelt);

    // Invisible flat ring for hit detection (click + hover)
    const ringGeo = new THREE.RingGeometry(innerRadius, outerRadius, 64);
    const ringMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    const hitRing = new THREE.Mesh(ringGeo, ringMat);
    hitRing.rotation.x = -Math.PI / 2;  // lay flat in XZ plane
    hitRing.userData = { planet: this.ASTEROID_BELT_PLANET, isAsteroidBelt: true };
    this.scene.add(hitRing);
    this.hitMeshes.push(hitRing);
  }

  private createOortCloudHitSphere(): void {
    // Large BackSide sphere matching the starfield shell radius.
    // Hit from inside (normal view) and outside (fully zoomed out).
    const geo = new THREE.SphereGeometry(2450, 32, 16);
    const mat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.userData = { planet: this.OORT_CLOUD_PLANET };
    this.scene.add(sphere);
    this.hitMeshes.push(sphere);   // added last → lowest priority (nearest hit wins)
  }

  private createComets(): void {
    for (const def of this.COMET_DEFS) {
      const planet: Planet = {
        name: def.name,
        name_sr: def.nameSr,
        radius: def.radius,
        distance_from_sun: def.a,   // AU (semi-major axis)
        orbital_period: def.period * 365.25,
        rotation_period: def.rotPeriod,
        color: def.color,
        description: def.description,
        satellites: 0,
        notable_satellites: [],
        is_star: false,
        is_comet: true,
        eccentricity: def.e,
        inclination: def.inc,
        ascending_node: def.node,
      };

      // Orbital elements — no boost for comets (already dramatic)
      const a = this.getOrbitRadius(def.a);
      const e = def.e;
      const b = a * Math.sqrt(1 - e * e);
      const incRad  = (def.inc  * Math.PI) / 180;
      const nodeRad = (def.node * Math.PI) / 180;
      const cosNode = Math.cos(nodeRad);
      const sinNode = Math.sin(nodeRad);
      const cosInc  = Math.cos(incRad);
      const sinInc  = Math.sin(incRad);

      // Orbit line: dashed-style via low opacity purple tint
      const orbitLine = this.createOrbitLine(a, b, e, cosNode, sinNode, cosInc, sinInc, 0x9977cc, 0.35);
      this.scene.add(orbitLine);

      // Nucleus (small glowing sphere)
      const vr = 1.2;
      const color = new THREE.Color(def.color);
      const geo = new THREE.SphereGeometry(vr, 16, 16);
      const mat = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.0,
        shininess: 20,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { planet };
      this.scene.add(mesh);

      const glowMesh = this.makeGlowMesh(vr, color);
      mesh.add(glowMesh);

      const hitMesh = this.makeHitMesh(vr, planet, glowMesh);
      this.scene.add(hitMesh);
      this.hitMeshes.push(hitMesh);

      // Tail: two vertices (comet-local origin + anti-solar offset)
      const tailPositions = new Float32Array([0, 0, 0, 0, 0, 0]);
      const tailGeo = new THREE.BufferGeometry();
      tailGeo.setAttribute('position', new THREE.BufferAttribute(tailPositions, 3));
      const tailMat = new THREE.LineBasicMaterial({
        color: def.color,
        transparent: true,
        opacity: 0.65,
      });
      const tailLine = new THREE.Line(tailGeo, tailMat);
      this.scene.add(tailLine);

      const perihelionVis = a * (1 - e);
      const speed = (1 / def.period) * 0.006; // same frame-rate factor as planets
      const meanAnomaly = def.startFraction * Math.PI * 2;

      const obj: CometObject = {
        planet, mesh, tailGeo, tailLine, hitMesh, glowMesh,
        perihelionVis, speed, meanAnomaly,
        a, b, e, cosNode, sinNode, cosInc, sinInc,
      };

      const initPos = this.keplerCometToWorld(obj);
      mesh.position.copy(initPos);
      hitMesh.position.copy(initPos);
      tailLine.position.copy(initPos);

      this.cometObjects.push(obj);
    }
  }

  /** Faint circle in the moon's orbital plane (tilted by inclination around X-axis). */
  private createMoonOrbitLine(radius: number, cosInc: number, sinInc: number): THREE.LineLoop {
    const N = 64;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const xOrb = Math.cos(a) * radius;
      const zOrb = Math.sin(a) * radius;
      pts.push(new THREE.Vector3(xOrb, sinInc * zOrb, cosInc * zOrb));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x445577, transparent: true, opacity: 0.45 });
    return new THREE.LineLoop(geo, mat);
  }

  private createMoons(): void {
    for (const def of this.MOON_DEFS) {
      // Find parent planet object by name
      const parentObj = this.planetObjects.find(
        p => (p.mesh.userData['planet'] as Planet).name === def.parentName
      );
      if (!parentObj) continue;

      const orbitRadius = def.orbitVis;
      const incRad = (def.incDeg * Math.PI) / 180;
      const cosInc = Math.cos(incRad);
      const sinInc = Math.sin(incRad);

      // Orbit ring (repositioned each frame with parent planet)
      const orbitLine = this.createMoonOrbitLine(orbitRadius, cosInc, sinInc);
      this.scene.add(orbitLine);

      // Moon sphere
      const color = new THREE.Color(def.color);
      const geo = new THREE.SphereGeometry(def.vr, 12, 12);
      const mat = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.35,
        shininess: 15,
      });
      const mesh = new THREE.Mesh(geo, mat);
      this.scene.add(mesh);

      // Speed: same frame-rate formula as planets (rad/frame at 1× sim speed)
      const speed = (365.25 / def.periodDays) * 0.006;
      const startAngle = Math.random() * Math.PI * 2;

      const obj: MoonObject = {
        mesh, orbitLine, orbitRadius, speed,
        angle: startAngle, cosInc, sinInc,
        parentPlanetObj: parentObj,
      };

      // Place at initial position
      const pp = parentObj.mesh.position;
      const x0 = Math.cos(startAngle) * orbitRadius;
      const z0 = Math.sin(startAngle) * orbitRadius;
      mesh.position.set(pp.x + x0, pp.y + sinInc * z0, pp.z + cosInc * z0);
      orbitLine.position.copy(pp);

      this.moonObjects.push(obj);
    }
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);

    const speed = this.simulationSpeed();

    // Screen-space hit sphere sizing: keep all hit spheres at ~30px radius
    // regardless of camera zoom distance.
    //   worldRadius = TARGET_PX × dist × tan(halfFov) / halfScreenH
    const canvas = this.canvasRef.nativeElement;
    const halfH = canvas.clientHeight / 2 || 1;
    const tanHalfFov = Math.tan((this.camera.fov * Math.PI) / 360);
    const HIT_PX = 30;   // hit sphere screen-space radius (px)

    for (const obj of this.planetObjects) {
      obj.meanAnomaly += obj.speed * speed;
      const pos = this.keplerToWorld(obj);
      obj.mesh.position.copy(pos);
      obj.hitMesh.position.copy(pos);
      obj.mesh.rotation.y += obj.rotationDir * 0.005;
      obj.ring?.position.copy(pos);

      // Hit sphere: always ~30px radius on screen regardless of zoom
      const dist = this.camera.position.distanceTo(pos);
      const hitWorldR = (HIT_PX / halfH) * dist * tanHalfFov;
      obj.hitMesh.scale.setScalar(hitWorldR / this.HIT_RADIUS);
    }

    // Sun hit sphere (fixed at origin) — screen-space sizing for the Sun only.
    // Asteroid belt ring and Oort Cloud sphere already have correct world-space
    // geometry and must NOT be dynamically rescaled.
    if (this.sunHitMesh) {
      this._tmpVec.set(0, 0, 0);
      const sunDist = this.camera.position.distanceTo(this._tmpVec);
      const sunHitR = (HIT_PX / halfH) * sunDist * tanHalfFov;
      this.sunHitMesh.scale.setScalar(sunHitR / this.HIT_RADIUS);
    }

    // ── Moons ──────────────────────────────────────────────────────────────────
    for (const obj of this.moonObjects) {
      obj.angle += obj.speed * speed;
      const pp = obj.parentPlanetObj.mesh.position;
      const x   = Math.cos(obj.angle) * obj.orbitRadius;
      const zOrb = Math.sin(obj.angle) * obj.orbitRadius;
      obj.mesh.position.set(
        pp.x + x,
        pp.y + obj.sinInc * zOrb,
        pp.z + obj.cosInc * zOrb,
      );
      obj.orbitLine.position.copy(pp);
    }

    // ── Comets ─────────────────────────────────────────────────────────────────
    for (const obj of this.cometObjects) {
      obj.meanAnomaly += obj.speed * speed;
      const pos = this.keplerCometToWorld(obj);
      obj.mesh.position.copy(pos);
      obj.hitMesh.position.copy(pos);
      obj.mesh.rotation.y += 0.003;

      // Screen-space hit sphere (same formula as planets)
      const cometDist = this.camera.position.distanceTo(pos);
      const cometHitR = (HIT_PX / halfH) * cometDist * tanHalfFov;
      obj.hitMesh.scale.setScalar(cometHitR / this.HIT_RADIUS);

      // Tail: anti-solar direction, length ∝ proximity to sun
      const distFromSun = pos.length();
      // Tail disappears beyond ~3× perihelion distance
      const tailLength = 55 * Math.exp(-distFromSun / (3 * obj.perihelionVis));
      const antiSolar = pos.clone().normalize().multiplyScalar(tailLength);

      const tailAttr = obj.tailGeo.attributes['position'] as THREE.BufferAttribute;
      tailAttr.setXYZ(0, 0, 0, 0);                        // nucleus (local origin)
      tailAttr.setXYZ(1, antiSolar.x, antiSolar.y, antiSolar.z); // tail end
      tailAttr.needsUpdate = true;
      obj.tailLine.position.copy(pos);
    }

    if (this.asteroidBelt) {
      this.asteroidBelt.rotation.y -= 0.00008 * speed;
    }

    // ── Double-click zoom animation (ease-in-out cubic) ────────────────────────
    if (this._zoomAnim) {
      const a = this._zoomAnim;
      a.t = Math.min(a.t + 0.04, 1);
      // Cubic ease-in-out
      const ease = a.t < 0.5
        ? 4 * a.t ** 3
        : 1 - (-2 * a.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(a.fromCam, a.toCam, ease);
      this.controls.target.lerpVectors(a.fromTarget, a.toTarget, ease);
      if (a.t >= 1) {
        this._zoomAnim = undefined;
        this.controls.enabled = true;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private updateMouseCoords(event: MouseEvent): void {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onCanvasMouseMove = (event: MouseEvent): void => {
    this.updateMouseCoords(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitMeshes);

    const canvas = this.canvasRef.nativeElement;

    // Reset previous hover state
    if (this.currentHoveredGlow) {
      (this.currentHoveredGlow.material as THREE.MeshBasicMaterial).opacity = 0;
      this.currentHoveredGlow = null;
    }
    if (this.currentHoveredBelt && this.asteroidBeltMat) {
      this.asteroidBeltMat.color.set(0x998877);
      this.asteroidBeltMat.size = 0.35;
      this.currentHoveredBelt = false;
    }

    if (hits.length > 0) {
      const data = hits[0].object.userData;
      const glowMesh = data['glowMesh'] as THREE.Mesh | undefined;
      const planet   = data['planet']   as Planet | undefined;

      if (glowMesh) {
        (glowMesh.material as THREE.MeshBasicMaterial).opacity = 0.45;
        this.currentHoveredGlow = glowMesh;
      } else if (data['isAsteroidBelt'] && this.asteroidBeltMat) {
        this.asteroidBeltMat.color.set(0xddccaa);
        this.asteroidBeltMat.size = 0.55;
        this.currentHoveredBelt = true;
      }
      if (planet) {
        // Show Oort Cloud tooltip only when fully zoomed out (camera far from origin)
        const showTooltip = !planet.is_oort_cloud || this.camera.position.length() > 1800;
        if (showTooltip) {
          const rect = canvas.getBoundingClientRect();
          const tx = event.clientX - rect.left + 14;
          const ty = event.clientY - rect.top - 10;
          this.ngZone.run(() => {
            this.tooltipPos.set({ x: tx, y: ty });
            this.hoveredPlanet.set({ name: planet.name_sr, color: planet.color });
          });
        } else {
          this.ngZone.run(() => this.hoveredPlanet.set(null));
        }
      }
      canvas.style.cursor = 'pointer';
    } else {
      this.ngZone.run(() => this.hoveredPlanet.set(null));
      canvas.style.cursor = 'default';
    }
  };

  // Hide tooltip on any OrbitControls interaction (rotate, pan, zoom)
  private onControlsStart = (): void => {
    if (this.hoveredPlanet()) {
      this.ngZone.run(() => this.hoveredPlanet.set(null));
    }
  };

  // Close info panel on scroll-wheel zoom (desktop)
  private onCanvasZoom = (): void => {
    this.ngZone.run(() => this.closeInfo.emit());
  };

  // Close info panel when a pinch gesture starts (two fingers on screen)
  private onCanvasTouchStart = (e: TouchEvent): void => {
    if (e.touches.length >= 2) {
      this.ngZone.run(() => this.closeInfo.emit());
    }
  };

  private onCanvasClick = (event: MouseEvent): void => {
    this.updateMouseCoords(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitMeshes);

    if (hits.length > 0) {
      const planet = hits[0].object.userData['planet'] as Planet | undefined;
      if (planet) {
        // Oort Cloud is only clickable when fully zoomed out (same threshold as tooltip)
        if (planet.is_oort_cloud && this.camera.position.length() <= 1800) return;
        this.planetSelected.emit(planet);
      }
    }
  };

  /** Double-click: smoothly zoom camera to focus on the clicked object. */
  private onCanvasDblClick = (event: MouseEvent): void => {
    this.updateMouseCoords(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitMeshes);
    if (hits.length === 0) return;

    const planet = hits[0].object.userData['planet'] as Planet | undefined;
    if (!planet || planet.is_oort_cloud) return;

    // Target world position of the object (hitMesh.position is always current)
    const targetPos = hits[0].object.position.clone();

    // Zoom distance: enough to see the object clearly, clamped to minDistance
    let zoomDist: number;
    if (planet.is_asteroid_belt) {
      zoomDist = 120;
    } else if (planet.is_comet) {
      zoomDist = 20;
    } else {
      const visR = this.VISUAL_SIZES[planet.name] ?? 2;
      zoomDist = Math.max(visR * 8, this.controls.minDistance + 5);
    }

    // Keep camera on its current side relative to the new focus point
    const dir = this.camera.position.clone().sub(targetPos).normalize();
    const toCam = targetPos.clone().addScaledVector(dir, zoomDist);

    // Hide tooltip and close info panel before animating
    this.ngZone.run(() => {
      this.hoveredPlanet.set(null);
      this.closeInfo.emit();
    });

    this.controls.enabled = false;
    this._zoomAnim = {
      fromCam:    this.camera.position.clone(),
      toCam,
      fromTarget: this.controls.target.clone(),
      toTarget:   targetPos,
      t: 0,
    };
  };

  private onResize = (): void => {
    const canvas = this.canvasRef.nativeElement;
    this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  };

  increaseSpeed(): void {
    this.simulationSpeed.update(v => v === 0 ? 0.125 : Math.min(v * 2, 64));
  }

  decreaseSpeed(): void {
    this.simulationSpeed.update(v => v <= 0.125 ? 0 : v / 2);
  }

  resetSpeed(): void {
    this.simulationSpeed.set(0.25);
  }

  // ── Mobile camera navigation ───────────────────────────────────────────────

  /** Begin continuous camera action (rotate / zoom). Stops previous action. */
  startNav(action: string): void {
    this.stopNav();
    const step = (): void => {
      switch (action) {
        case 'rotateLeft':  this.shiftCameraAngle(-0.04,  0);    break;
        case 'rotateRight': this.shiftCameraAngle( 0.04,  0);    break;
        case 'rotateUp':    this.shiftCameraAngle( 0,    -0.04); break;
        case 'rotateDown':  this.shiftCameraAngle( 0,     0.04); break;
        case 'zoomIn':      this.dollyCamera(0.97);               break;
        case 'zoomOut':     this.dollyCamera(1.03);               break;
        case 'panLeft':     this.panCamera(-1,  0); break;
        case 'panRight':    this.panCamera( 1,  0); break;
        case 'panUp':       this.panCamera( 0,  1); break;
        case 'panDown':     this.panCamera( 0, -1); break;
      }
    };
    step();
    this._navInterval = setInterval(step, 100);
  }

  stopNav(): void {
    if (this._navInterval !== undefined) {
      clearInterval(this._navInterval);
      this._navInterval = undefined;
    }
  }

  /** Rotate camera around the orbit target.
   *  deltaTheta = horizontal (Y-axis), deltaPhi = vertical (polar angle). */
  private shiftCameraAngle(deltaTheta: number, deltaPhi: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += deltaTheta;
    spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi + deltaPhi));
    offset.setFromSpherical(spherical);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  /** Zoom camera in/out by scaling the distance to the orbit target. */
  private dollyCamera(factor: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const dist = offset.length() * factor;
    if (dist >= this.controls.minDistance && dist <= this.controls.maxDistance) {
      offset.setLength(dist);
      this.camera.position.copy(this.controls.target).add(offset);
      this.controls.update();
    }
  }

  /** Pan camera (and orbit target) in the camera's local XY plane.
   *  Speed scales with distance so panning feels consistent at any zoom. */
  private panCamera(dx: number, dy: number): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const speed = dist * 0.008;
    const right = new THREE.Vector3();
    const up    = new THREE.Vector3();
    const _fwd  = new THREE.Vector3();
    this.camera.matrix.extractBasis(right, up, _fwd);
    const offset = right.multiplyScalar(dx * speed)
                        .addScaledVector(up, dy * speed);
    this.camera.position.add(offset);
    this.controls.target.add(offset);
    this.controls.update();
  }
}
