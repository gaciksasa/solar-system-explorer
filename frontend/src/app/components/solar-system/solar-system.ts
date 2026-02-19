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

  ngAfterViewInit(): void {
    this.initScene();
    this.buildSolarSystem();
    this.createAsteroidBelt();
    this.createOortCloudHitSphere();
    this.animate();
    window.addEventListener('resize', this.onResize);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animationId);
    this.stopNav();
    window.removeEventListener('resize', this.onResize);
    const canvas = this.canvasRef.nativeElement;
    canvas.removeEventListener('click', this.onCanvasClick);
    canvas.removeEventListener('mousemove', this.onCanvasMouseMove);
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
      canvas.addEventListener('mousemove', this.onCanvasMouseMove);
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

      // Saturn's rings (attached to planet mesh)
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
        mesh.add(ring);
      }

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
    cosNode: number, sinNode: number, cosInc: number, sinInc: number
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
    const mat = new THREE.LineBasicMaterial({ color: 0x7788bb, transparent: true, opacity: 0.75 });
    return new THREE.LineLoop(geo, mat);
  }

  /**
   * Convert mean anomaly M → 3D world position using Kepler's equation.
   *
   * Kepler's equation:  M = E − e·sin(E)
   * Solved iteratively via Newton-Raphson (5 iterations → machine precision for e < 0.9).
   */
  private keplerToWorld(obj: PlanetObject): THREE.Vector3 {
    let E = obj.meanAnomaly;
    for (let i = 0; i < 5; i++) {
      E = E - (E - obj.e * Math.sin(E) - obj.meanAnomaly) / (1 - obj.e * Math.cos(E));
    }
    const xOrb = obj.a * (Math.cos(E) - obj.e);
    const yOrb = obj.b * Math.sin(E);
    return new THREE.Vector3(
      obj.cosNode * xOrb - obj.sinNode * obj.cosInc * yOrb,
      obj.sinInc * yOrb,
      obj.sinNode * xOrb + obj.cosNode * obj.cosInc * yOrb,
    );
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

    if (this.asteroidBelt) {
      this.asteroidBelt.rotation.y -= 0.00008 * speed;
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

  private onResize = (): void => {
    const canvas = this.canvasRef.nativeElement;
    this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  };

  increaseSpeed(): void {
    this.simulationSpeed.update(v => Math.min(v * 2, 64));
  }

  decreaseSpeed(): void {
    this.simulationSpeed.update(v => Math.max(v / 2, 0.125));
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
