import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  COLS,
  ROWS,
  isWater,
  pieceAt,
} from '../engine/board';
import type {
  GameState,
  MoveEvent,
  Piece,
  Pos,
  Side,
} from '../engine/types';
import { createBeast, createDenMarker, createTrapMarker } from './beastFactory';
import { mulberry32, sealTexture, stoneTexture, woodTexture } from './textures';

export const CELL = 1;
export const BOARD_WIDTH = COLS * CELL;
export const BOARD_HEIGHT = ROWS * CELL;

export function cellToWorld(pos: Pos): THREE.Vector3 {
  return new THREE.Vector3((pos.x - (COLS - 1) / 2) * CELL, 0, ((ROWS - 1) / 2 - pos.y) * CELL);
}

export function faceEnemy(group: THREE.Group, side: Side): void {
  group.rotation.y = side === 'crimson' ? Math.PI : 0;
}

export function worldToCell(point: THREE.Vector3): Pos {
  return {
    x: Math.round(point.x / CELL + (COLS - 1) / 2),
    y: Math.round((ROWS - 1) / 2 - point.z / CELL),
  };
}

type PieceNode = {
  piece: Piece;
  group: THREE.Group;
  home: THREE.Vector3;
  target: THREE.Vector3;
  start: THREE.Vector3;
  progress: number;
  duration: number;
  arc: number;
  kind: 'idle' | 'move' | 'jump' | 'sink' | 'rise';
  captured: boolean;
};

export type SceneSettings = {
  reducedMotion: boolean;
};

export class BeastScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly raycaster = new THREE.Raycaster();
  readonly pointer = new THREE.Vector2();
  readonly boardGroup = new THREE.Group();
  readonly pieceGroup: THREE.Group;
  readonly effectGroup: THREE.Group;
  readonly markersGroup: THREE.Group;

  private pieceNodes = new Map<string, PieceNode>();
  private animations: Array<(delta: number) => boolean> = [];
  private timer = new THREE.Timer();
  private dragging = false;
  private dragDistance = 0;
  private lastPointer = { x: 0, y: 0 };
  private pointerDown = false;
  private resizeObserver?: ResizeObserver;
  private disposed = false;
  private reducedMotion = false;
  private renderCount = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly groundPlane: THREE.Mesh;
  private readonly selectionRing: THREE.Mesh;
  private readonly legalMarkers: THREE.Mesh[] = [];

  onCellClick?: (pos: Pos) => void;
  onCameraChange?: (azimuth: number, polar: number, distance: number) => void;

  constructor(canvas: HTMLCanvasElement, settings: SceneSettings = { reducedMotion: false }) {
    this.canvas = canvas;
    this.reducedMotion = settings.reducedMotion;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a1110);
    this.scene.fog = new THREE.FogExp2(0x0a1110, 0.025);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 9.5, 10.5);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(14);
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(82);
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.8;
    this.controls.addEventListener('change', () => this.reportCamera());

    this.scene.add(new THREE.HemisphereLight(0xf6e6c4, 0x10201a, 1.15));
    const key = new THREE.DirectionalLight(0xffe6b8, 2.2);
    key.position.set(-6, 12, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fd4c4, 0.8);
    rim.position.set(6, 5, -8);
    this.scene.add(rim);

    this.scene.add(this.boardGroup);
    this.pieceGroup = new THREE.Group();
    this.effectGroup = new THREE.Group();
    this.markersGroup = new THREE.Group();
    this.scene.add(this.pieceGroup);
    this.scene.add(this.effectGroup);
    this.scene.add(this.markersGroup);

    this.groundPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0x0a1110, roughness: 1 }),
    );
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.position.y = -1.2;
    this.groundPlane.receiveShadow = true;
    this.scene.add(this.groundPlane);

    this.selectionRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.025, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xd5b36b, transparent: true, opacity: 0.9 }),
    );
    this.selectionRing.rotation.x = Math.PI / 2;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    this.buildTable();
    this.buildBoard();
    this.buildEnvironment();
    this.bindPointer();
    this.resize();
    this.animate = this.animate.bind(this);
    this.renderer.setAnimationLoop(this.animate);
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
  }

  /** 渲染一帧，供无头环境的像素审计与稳定截图使用。 */
  renderOnce() {
    this.controls.update();
    this.reportCamera();
    this.renderer.render(this.scene, this.camera);
  }

  /** 设置相机方位角、俯仰角与距离，仍围绕棋盘中心。 */
  setCameraOrbit(azimuth: number, polar: number, distance: number) {
    const offset = new THREE.Vector3().setFromSphericalCoords(
      THREE.MathUtils.clamp(distance, this.controls.minDistance, this.controls.maxDistance),
      THREE.MathUtils.clamp(polar, this.controls.minPolarAngle, this.controls.maxPolarAngle),
      azimuth,
    );
    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.reportCamera();
  }

  private lastReportedCamera = '';
  private windowUpHandler = (event: PointerEvent) => {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    if (this.dragging) {
      this.dragging = false;
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    if (
      event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom
    ) {
      this.dragging = false;
      return;
    }
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const pos = this.pickCell();
    if (pos) this.onCellClick?.(pos);
  };
  private windowBlurHandler = () => {
    this.pointerDown = false;
    this.dragging = false;
  };

  private reportCamera() {
    const spherical = new THREE.Spherical().setFromVector3(this.camera.position);
    const key = `${spherical.theta.toFixed(4)}|${spherical.phi.toFixed(4)}|${spherical.radius.toFixed(3)}`;
    if (key === this.lastReportedCamera) return;
    this.lastReportedCamera = key;
    this.onCameraChange?.(spherical.theta, spherical.phi, spherical.radius);
  }

  private buildTable() {
    const wood = woodTexture(3);
    const tableTop = new THREE.Mesh(
      new THREE.BoxGeometry(12.5, 0.5, 14.5),
      new THREE.MeshStandardMaterial({ map: wood, roughness: 0.72, metalness: 0.04 }),
    );
    tableTop.position.y = -0.85;
    tableTop.receiveShadow = true;
    this.boardGroup.add(tableTop);

    const bronze = new THREE.MeshStandardMaterial({ color: 0x8a6a35, roughness: 0.35, metalness: 0.65 });
    for (const [width, depth, x, z] of [
      [12.7, 0.18, 0, -7.25],
      [12.7, 0.18, 0, 7.25],
      [0.18, 14.5, -6.25, 0],
      [0.18, 14.5, 6.25, 0],
    ] as const) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(width, 0.56, depth), bronze);
      trim.position.set(x, -0.85, z);
      this.boardGroup.add(trim);
    }

    const seal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.08, 32),
      new THREE.MeshStandardMaterial({ map: sealTexture('弈', '#c8513f'), roughness: 0.6 }),
    );
    seal.position.set(5.4, -0.56, 6.2);
    this.boardGroup.add(seal);
  }

  private buildBoard() {
    const stone = stoneTexture(11);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_WIDTH + 0.7, 0.34, BOARD_HEIGHT + 0.7),
      new THREE.MeshStandardMaterial({ map: stone, color: 0xcbb98f, roughness: 0.86 }),
    );
    board.position.y = -0.18;
    board.receiveShadow = true;
    this.boardGroup.add(board);

    const gridMaterial = new THREE.LineBasicMaterial({ color: 0x3b2a1a, transparent: true, opacity: 0.75 });
    const points: THREE.Vector3[] = [];
    for (let x = 0; x <= COLS; x += 1) {
      points.push(new THREE.Vector3((x - COLS / 2) * CELL, 0.005, -BOARD_HEIGHT / 2));
      points.push(new THREE.Vector3((x - COLS / 2) * CELL, 0.005, BOARD_HEIGHT / 2));
    }
    for (let y = 0; y <= ROWS; y += 1) {
      points.push(new THREE.Vector3(-BOARD_WIDTH / 2, 0.005, (y - ROWS / 2) * CELL));
      points.push(new THREE.Vector3(BOARD_WIDTH / 2, 0.005, (y - ROWS / 2) * CELL));
    }
    const grid = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), gridMaterial);
    this.boardGroup.add(grid);

    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x3f8f80,
      transparent: true,
      opacity: 0.72,
      roughness: 0.18,
      metalness: 0.1,
      emissive: 0x1d4f47,
      emissiveIntensity: 0.25,
    });
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (!isWater({ x, y })) continue;
        const water = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.98, 0.06, CELL * 0.98), waterMaterial);
        water.position.copy(cellToWorld({ x, y }));
        water.position.y = 0.01;
        this.boardGroup.add(water);
      }
    }

    for (const side of ['crimson', 'teal'] as const) {
      const denMarker = createDenMarker(side);
      denMarker.position.copy(cellToWorld(side === 'teal' ? { x: 3, y: 0 } : { x: 3, y: 8 }));
      denMarker.position.y = 0.02;
      this.boardGroup.add(denMarker);
      for (const trap of side === 'teal'
        ? [{ x: 2, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 1 }]
        : [{ x: 2, y: 8 }, { x: 4, y: 8 }, { x: 3, y: 7 }]) {
        const marker = createTrapMarker();
        marker.position.copy(cellToWorld(trap));
        marker.position.y = 0.02;
        this.boardGroup.add(marker);
      }
    }
  }

  private buildEnvironment() {
    const random = mulberry32(99);
    for (let index = 0; index < 18; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = 9 + random() * 9;
      const rockHeight = 1.2 + random() * 3.2;
      void rockHeight;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.8 + random() * 1.4, 0),
        new THREE.MeshStandardMaterial({ map: stoneTexture(index + 2), color: 0x6f7d6d, roughness: 0.95 }),
      );
      rock.position.set(Math.cos(angle) * radius, -0.4 + random() * 0.4, Math.sin(angle) * radius);
      rock.rotation.set(random() * 3, random() * 3, random() * 3);
      rock.castShadow = true;
      this.scene.add(rock);
    }

    for (let index = 0; index < 10; index += 1) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.14, 0.8, 8),
        new THREE.MeshStandardMaterial({ color: 0x4a2a16, roughness: 0.9 }),
      );
      trunk.position.y = 0.4;
      tree.add(trunk);
      for (let layer = 0; layer < 3; layer += 1) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.65 - layer * 0.15, 0.55, 12),
          new THREE.MeshStandardMaterial({ color: layer % 2 ? 0x2f6f55 : 0x3d8563, roughness: 0.85 }),
        );
        cone.position.y = 0.85 + layer * 0.42;
        tree.add(cone);
      }
      const angle = (index / 10) * Math.PI * 2 + random() * 0.4;
      const radius = 8.5 + random() * 4;
      tree.position.set(Math.cos(angle) * radius, -0.6, Math.sin(angle) * radius);
      tree.scale.setScalar(0.8 + random() * 0.8);
      this.scene.add(tree);
    }

    for (const [x, z, side] of [[-7.8, 6.8, 'teal'], [7.8, -6.8, 'crimson']] as const) {
      const dish = new THREE.Group();
      const bowl = new THREE.Mesh(
        new THREE.CylinderGeometry(1.0, 0.65, 0.28, 32),
        new THREE.MeshStandardMaterial({ color: 0x3a1d12, roughness: 0.6 }),
      );
      bowl.position.y = -0.42;
      dish.add(bowl);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(1.0, 0.05, 8, 32),
        new THREE.MeshStandardMaterial({ color: side === 'crimson' ? 0xc8513f : 0x4f9d8b, roughness: 0.4, metalness: 0.2 }),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = -0.28;
      dish.add(rim);
      dish.position.set(x, 0, z);
      this.scene.add(dish);
    }
  }

  private bindPointer() {
    this.canvas.addEventListener('pointerdown', (event) => {
      this.pointerDown = true;
      this.dragging = false;
      this.dragDistance = 0;
      this.lastPointer = { x: event.clientX, y: event.clientY };
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.pointerDown) return;
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
      if (this.dragDistance > 6) this.dragging = true;
      this.lastPointer = { x: event.clientX, y: event.clientY };
    });
    this.canvas.addEventListener('pointerup', (event) => {
      if (this.pointerDown && !this.dragging) {
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        const pos = this.pickCell();
        if (pos) this.onCellClick?.(pos);
      }
      this.pointerDown = false;
      this.dragging = false;
    });
    this.canvas.addEventListener('pointercancel', () => {
      this.pointerDown = false;
      this.dragging = false;
    });
    window.addEventListener('pointerup', this.windowUpHandler);
    window.addEventListener('blur', this.windowBlurHandler);
    this.canvas.addEventListener('pointerleave', () => {
      if (!this.pointerDown) this.dragging = false;
    });
  }

  pickCell(): Pos | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return null;
    const pos = worldToCell(hit);
    if (pos.x < 0 || pos.x >= COLS || pos.y < 0 || pos.y >= ROWS) return null;
    return pos;
  }

  syncBoard(state: GameState, animate = false) {
    const seen = new Set<string>();
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const piece = pieceAt(state.board, { x, y });
        if (!piece) continue;
        seen.add(piece.id);
        let node = this.pieceNodes.get(piece.id);
        const target = cellToWorld({ x, y });
        if (!node) {
          const group = createBeast(piece.type, piece.side);
          group.position.copy(target);
          faceEnemy(group, piece.side);
          this.pieceGroup.add(group);
          node = {
            piece,
            group,
            home: target.clone(),
            target: target.clone(),
            start: target.clone(),
            progress: 1,
            duration: 1,
            arc: 0,
            kind: 'idle',
            captured: false,
          };
          this.pieceNodes.set(piece.id, node);
        } else if (animate && node.target.distanceTo(target) > 0.001) {
          this.startMove(node, target, 'move');
        } else {
          node.group.position.copy(target);
          node.target.copy(target);
        }
      }
    }
    for (const [id, node] of this.pieceNodes) {
      if (!seen.has(id) && !node.captured) {
        node.captured = true;
        this.flyToBowl(node);
      }
    }
  }

  playMove(event: MoveEvent) {
    const from = cellToWorld(event.move.from);
    const to = cellToWorld(event.move.to);
    const capturedNode = event.captured ? this.pieceNodes.get(event.captured.id) : undefined;
    if (capturedNode) this.flyToBowl(capturedNode);
    let movedNode = Array.from(this.pieceNodes.values()).find(
      (candidate) => candidate.piece.side === event.side && candidate.piece.type === event.beast,
    );
    if (!movedNode) {
      movedNode = Array.from(this.pieceNodes.values()).find(
        (candidate) => candidate.group.position.distanceTo(from) < 0.6,
      );
    }
    if (!movedNode) {
      const group = createBeast(event.beast, event.side);
      group.position.copy(from);
      faceEnemy(group, event.side);
      this.pieceGroup.add(group);
      movedNode = {
        piece: { id: `${event.side}-${event.beast}`, type: event.beast, side: event.side },
        group,
        home: from.clone(),
        target: to.clone(),
        start: from.clone(),
        progress: 1,
        duration: 1,
        arc: 0,
        kind: 'idle',
        captured: false,
      };
      this.pieceNodes.set(movedNode.piece.id, movedNode);
    }
    this.startMove(movedNode, to, event.move.kind === 'jump' ? 'jump' : isWater(event.move.to) ? 'sink' : 'move');
    if (event.move.kind === 'jump') this.spawnImpact(to, 0xd5b36b);
    if (isWater(event.move.to)) this.spawnRipple(to);
    if (event.captured) this.spawnImpact(to, 0xc8513f);
    if (event.trapApplied) this.spawnRing(to, 0xd5b36b);
    if (event.result?.reason === 'den') this.spawnBurst(to);
  }

  private startMove(node: PieceNode, target: THREE.Vector3, kind: PieceNode['kind']) {
    node.start = node.group.position.clone();
    node.target = target.clone();
    node.kind = kind;
    node.progress = 0;
    node.arc = kind === 'jump' ? 1.6 : kind === 'sink' ? -0.18 : 0.08;
    node.duration = this.reducedMotion ? 0.12 : kind === 'jump' ? 0.72 : kind === 'sink' ? 0.55 : 0.36;
  }

  private flyToBowl(node: PieceNode) {
    const side = node.piece.side;
    const bowl = side === 'teal' ? new THREE.Vector3(-7.8, 0.2, 6.8) : new THREE.Vector3(7.8, 0.2, -6.8);
    const start = node.group.position.clone();
    const duration = this.reducedMotion ? 0.15 : 0.9;
    this.animations.push((delta) => {
      const progress = Math.min(1, (node.progress += delta / duration));
      const eased = 1 - (1 - progress) ** 3;
      node.group.position.lerpVectors(start, bowl, eased);
      node.group.position.y = THREE.MathUtils.lerp(start.y, bowl.y, eased) + Math.sin(progress * Math.PI) * 1.8;
      node.group.rotation.z = progress * 3.2;
      node.group.scale.setScalar(Math.max(0.05, 1 - progress * 0.7));
      if (progress >= 1) {
        this.pieceGroup.remove(node.group);
        this.pieceNodes.delete(node.piece.id);
        return false;
      }
      return true;
    });
  }

  private spawnRipple(position: THREE.Vector3) {
    if (this.reducedMotion) return;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.02, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0x9fd4c7, transparent: true, opacity: 0.8 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(position);
    ring.position.y = 0.04;
    this.effectGroup.add(ring);
    let progress = 0;
    this.animations.push((delta) => {
      progress += delta / 0.8;
      ring.scale.setScalar(1 + progress * 3.2);
      ring.material.opacity = Math.max(0, 0.8 - progress);
      if (progress >= 1) {
        this.effectGroup.remove(ring);
        return false;
      }
      return true;
    });
  }

  private spawnImpact(position: THREE.Vector3, color: number) {
    if (this.reducedMotion) return;
    const count = 14;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities: THREE.Vector3[] = [];
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = position.x;
      positions[index * 3 + 1] = position.y + 0.2;
      positions[index * 3 + 2] = position.z;
      velocities.push(new THREE.Vector3((Math.random() - 0.5) * 2.4, Math.random() * 2.4, (Math.random() - 0.5) * 2.4));
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: 0.08, transparent: true, opacity: 1 }));
    this.effectGroup.add(points);
    let progress = 0;
    this.animations.push((delta) => {
      progress += delta / 0.55;
      const array = geometry.attributes.position.array as Float32Array;
      for (let index = 0; index < count; index += 1) {
        array[index * 3] += velocities[index].x * delta;
        array[index * 3 + 1] += (velocities[index].y - progress * 6) * delta;
        array[index * 3 + 2] += velocities[index].z * delta;
      }
      geometry.attributes.position.needsUpdate = true;
      points.material.opacity = Math.max(0, 1 - progress);
      if (progress >= 1) {
        this.effectGroup.remove(points);
        return false;
      }
      return true;
    });
  }

  private spawnRing(position: THREE.Vector3, color: number) {
    if (this.reducedMotion) return;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.04, 8, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(position);
    ring.position.y = 0.1;
    this.effectGroup.add(ring);
    let progress = 0;
    this.animations.push((delta) => {
      progress += delta / 0.7;
      ring.scale.setScalar(1 + progress * 1.8);
      ring.position.y = 0.1 + progress * 0.8;
      ring.material.opacity = Math.max(0, 0.9 - progress);
      if (progress >= 1) {
        this.effectGroup.remove(ring);
        return false;
      }
      return true;
    });
  }

  private spawnBurst(position: THREE.Vector3) {
    const count = 40;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities: THREE.Vector3[] = [];
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = position.x;
      positions[index * 3 + 1] = position.y + 0.2;
      positions[index * 3 + 2] = position.z;
      velocities.push(new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5));
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xd5b36b, size: 0.12, transparent: true, opacity: 1 }));
    this.effectGroup.add(points);
    let progress = 0;
    this.animations.push((delta) => {
      progress += delta / 1.0;
      const array = geometry.attributes.position.array as Float32Array;
      for (let index = 0; index < count; index += 1) {
        array[index * 3] += velocities[index].x * delta;
        array[index * 3 + 1] += (velocities[index].y - progress * 5) * delta;
        array[index * 3 + 2] += velocities[index].z * delta;
      }
      geometry.attributes.position.needsUpdate = true;
      points.material.opacity = Math.max(0, 1 - progress);
      if (progress >= 1) {
        this.effectGroup.remove(points);
        return false;
      }
      return true;
    });
  }

  showSelection(pos: Pos | null) {
    if (!pos) {
      this.selectionRing.visible = false;
      return;
    }
    this.selectionRing.visible = true;
    this.selectionRing.position.copy(cellToWorld(pos));
    this.selectionRing.position.y = 0.03;
  }

  showLegalMoves(targets: Pos[]) {
    for (const marker of this.legalMarkers) {
      this.markersGroup.remove(marker);
    }
    this.legalMarkers.length = 0;
    for (const pos of targets) {
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.035, 20),
        new THREE.MeshBasicMaterial({ color: isWater(pos) ? 0x9fd4c7 : 0xd5b36b, transparent: true, opacity: 0.8 }),
      );
      marker.position.copy(cellToWorld(pos));
      marker.position.y = 0.025;
      this.markersGroup.add(marker);
      this.legalMarkers.push(marker);
    }
  }

  clearMarkers() {
    this.showSelection(null);
    this.showLegalMoves([]);
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const portrait = width < 760;
    const minDistance = portrait ? 13 : 8;
    const maxDistance = portrait ? 28 : 20;
    this.controls.minDistance = minDistance;
    this.controls.maxDistance = maxDistance;
    this.camera.updateProjectionMatrix();
  }

  private animate() {
    if (this.disposed) return;
    this.renderCount += 1;
    if (typeof window !== 'undefined') {
      const orientations: Record<string, number> = {};
      for (const node of this.pieceNodes.values()) {
        orientations[`${node.piece.side}:${node.piece.type}`] = Number(node.group.rotation.y.toFixed(3));
      }
      window.__shanHaiScene = {
        renders: this.renderCount,
        pieces: this.pieceNodes.size,
        reducedMotion: this.reducedMotion,
        orientations,
      };
    }
    this.timer.update();
    const delta = Math.min(this.timer.getDelta(), 0.05);
    this.controls.update();
    this.reportCamera();
    for (const node of this.pieceNodes.values()) {
      if (node.kind === 'idle' || node.progress >= 1) continue;
      node.progress = Math.min(1, node.progress + delta / node.duration);
      const eased = 1 - (1 - node.progress) ** 3;
      node.group.position.lerpVectors(node.start, node.target, eased);
      node.group.position.y = THREE.MathUtils.lerp(node.start.y, node.target.y, eased) + Math.sin(node.progress * Math.PI) * node.arc;
      if (node.kind === 'sink') node.group.position.y -= node.progress * 0.12;
      if (node.kind === 'jump') node.group.rotation.y += delta * 4;
      if (node.progress >= 1) {
        node.kind = 'idle';
        node.group.position.copy(node.target);
        node.group.rotation.z = 0;
        node.group.rotation.y = node.piece.side === 'crimson' ? Math.PI : 0;
      }
    }
    this.animations = this.animations.filter((animation) => animation(delta));
    if (!this.reducedMotion) {
      this.selectionRing.rotation.z += delta * 0.6;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('pointerup', this.windowUpHandler);
    window.removeEventListener('blur', this.windowBlurHandler);
    this.resizeObserver?.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
