import * as THREE from 'three';
import { BEAST_NAMES, SIDE_COLORS } from '../engine/board';
import type { BeastType, Side } from '../engine/types';
import { mulberry32, namePlateTexture } from './textures';

const RANK: Record<BeastType, number> = {
  rat: 1,
  cat: 2,
  dog: 3,
  wolf: 4,
  leopard: 5,
  tiger: 6,
  lion: 7,
  elephant: 8,
};

function material(color: number, roughness = 0.72, metalness = 0.05) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function sphere(radius: number, color: number, widthSegments = 24, heightSegments = 18) {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, widthSegments, heightSegments), material(color));
}

function ellipsoid(width: number, height: number, depth: number, color: number) {
  const mesh = sphere(1, color);
  mesh.scale.set(width, height, depth);
  return mesh;
}

function box(width: number, height: number, depth: number, color: number) {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material(color));
}

function cylinder(radiusTop: number, radiusBottom: number, height: number, color: number, segments = 20) {
  return new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material(color));
}

function cone(radius: number, height: number, color: number, segments = 18) {
  return new THREE.Mesh(new THREE.ConeGeometry(radius, height, segments), material(color));
}

function addEars(group: THREE.Group, left: THREE.Vector3, right: THREE.Vector3, size: number, color: number) {
  for (const position of [left, right]) {
    const ear = sphere(size, color);
    ear.position.copy(position);
    group.add(ear);
    const inner = sphere(size * 0.55, 0xf3c9a4);
    inner.position.copy(position).multiplyScalar(1.02);
    inner.position.z += size * 0.35;
    group.add(inner);
  }
}

function addEyes(group: THREE.Group, left: THREE.Vector3, right: THREE.Vector3, radius: number, color = 0x101010) {
  for (const position of [left, right]) {
    const eye = sphere(radius, color, 12, 10);
    eye.position.copy(position);
    group.add(eye);
    const highlight = sphere(radius * 0.35, 0xfff8e0, 8, 6);
    highlight.position.copy(position);
    highlight.position.x += radius * 0.3;
    highlight.position.y += radius * 0.3;
    highlight.position.z += radius * 0.75;
    group.add(highlight);
  }
}

function addSnout(group: THREE.Group, position: THREE.Vector3, size: number, color: number) {
  const snout = ellipsoid(size * 1.25, size * 0.8, size, color);
  snout.position.copy(position);
  group.add(snout);
  const nose = sphere(size * 0.28, 0x1d1010, 10, 8);
  nose.position.set(position.x, position.y + size * 0.25, position.z + size * 0.95);
  group.add(nose);
}

function addTail(group: THREE.Group, position: THREE.Vector3, length: number, color: number, curve = 0.4) {
  const tail = cylinder(length * 0.12, length * 0.04, length, color, 10);
  tail.position.copy(position);
  tail.rotation.z = curve;
  group.add(tail);
  const tip = sphere(length * 0.16, color, 10, 8);
  tip.position.set(position.x + Math.sin(curve) * length * 0.8, position.y + Math.cos(curve) * length * 0.8, position.z);
  group.add(tip);
}

function addArmor(group: THREE.Group, y: number, radius: number, color: number) {
  const plate = cylinder(radius * 1.05, radius * 1.2, radius * 0.35, color, 24);
  plate.position.y = y;
  group.add(plate);
  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.08, radius * 0.06, 8, 28),
    material(0xd5b36b, 0.4, 0.5),
  );
  trim.rotation.x = Math.PI / 2;
  trim.position.y = y + radius * 0.18;
  group.add(trim);
}

function addBlade(group: THREE.Group, position: THREE.Vector3, rotation: number, color = 0xc9d0c7) {
  const blade = box(0.05, 0.42, 0.12, color);
  blade.position.copy(position);
  blade.rotation.z = rotation;
  group.add(blade);
  const guard = box(0.16, 0.05, 0.16, 0x8a6a35);
  guard.position.copy(position);
  guard.position.y -= 0.22;
  guard.rotation.z = rotation;
  group.add(guard);
}

function addShield(group: THREE.Group, position: THREE.Vector3, color: number) {
  const shield = cylinder(0.3, 0.3, 0.06, color, 28);
  shield.rotation.x = Math.PI / 2;
  shield.position.copy(position);
  group.add(shield);
  const boss = sphere(0.09, 0xd5b36b, 12, 10);
  boss.position.copy(position);
  boss.position.z += 0.06;
  group.add(boss);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 8, 28), material(0xd5b36b, 0.4, 0.5));
  rim.position.copy(position);
  group.add(rim);
}

function addCape(group: THREE.Group, color: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.32, 0.2);
  shape.lineTo(0.32, 0.2);
  shape.lineTo(0.42, -0.55);
  shape.lineTo(-0.42, -0.55);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
  const cape = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide }));
  cape.position.set(0, 0.1, -0.28);
  group.add(cape);
}

function addCloudShoulders(group: THREE.Group, radius: number, color: number) {
  for (const side of [-1, 1]) {
    const shoulder = sphere(radius * 0.42, color, 16, 12);
    shoulder.position.set(side * radius * 0.85, radius * 0.8, 0);
    group.add(shoulder);
    const cloud = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.25, radius * 0.07, 8, 20),
      material(0xd5b36b, 0.45, 0.4),
    );
    cloud.position.copy(shoulder.position);
    cloud.position.z += radius * 0.2;
    cloud.rotation.x = Math.PI / 2;
    group.add(cloud);
  }
}

function addPattern(group: THREE.Group, y: number, radius: number, color: number, count = 8) {
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const mark = box(radius * 0.16, radius * 0.08, radius * 0.06, color);
    mark.position.set(Math.cos(angle) * radius * 0.95, y, Math.sin(angle) * radius * 0.95);
    mark.rotation.y = -angle;
    group.add(mark);
  }
}

function addTrunk(group: THREE.Group, position: THREE.Vector3, length: number, color: number) {
  const segments = 5;
  for (let index = 0; index < segments; index += 1) {
    const radius = 0.16 - index * 0.018;
    const segment = cylinder(radius, radius + 0.018, length / segments, color, 16);
    segment.position.set(position.x, position.y - index * length / segments * 0.82, position.z + index * 0.035);
    segment.rotation.x = 0.18 * index;
    group.add(segment);
  }
}

function addTusks(group: THREE.Group, left: THREE.Vector3, right: THREE.Vector3) {
  for (const position of [left, right]) {
    const tusk = cone(0.05, 0.4, 0xf1e4bd, 12);
    tusk.position.copy(position);
    tusk.rotation.x = -0.5;
    group.add(tusk);
  }
}

function buildRat(side: Side) {
  const group = new THREE.Group();
  const body = ellipsoid(0.34, 0.3, 0.42, 0x9a8f7c);
  body.position.y = 0.3;
  group.add(body);
  addEars(group, new THREE.Vector3(-0.22, 0.58, 0.08), new THREE.Vector3(0.22, 0.58, 0.08), 0.15, 0xb9a78d);
  addEyes(group, new THREE.Vector3(-0.12, 0.43, 0.34), new THREE.Vector3(0.12, 0.43, 0.34), 0.055);
  addSnout(group, new THREE.Vector3(0, 0.32, 0.4), 0.13, 0xc7b79c);
  addTail(group, new THREE.Vector3(0, 0.22, -0.38), 0.48, 0xb9a78d, 0.9);
  addArmor(group, 0.38, 0.36, side === 'crimson' ? 0x8c2f25 : 0x2f6f63);
  return group;
}

function buildCat(side: Side) {
  const group = new THREE.Group();
  const body = ellipsoid(0.32, 0.34, 0.4, 0xd8c4a2);
  body.position.y = 0.36;
  group.add(body);
  addEars(group, new THREE.Vector3(-0.18, 0.64, 0.02), new THREE.Vector3(0.18, 0.64, 0.02), 0.13, 0xd8c4a2);
  addEyes(group, new THREE.Vector3(-0.11, 0.46, 0.33), new THREE.Vector3(0.11, 0.46, 0.33), 0.05);
  const mask = box(0.34, 0.1, 0.12, side === 'crimson' ? 0x7d2920 : 0x285f55);
  mask.position.set(0, 0.46, 0.31);
  group.add(mask);
  addSnout(group, new THREE.Vector3(0, 0.34, 0.38), 0.1, 0xe6d3b0);
  addBlade(group, new THREE.Vector3(-0.34, 0.34, 0.2), 0.5);
  addBlade(group, new THREE.Vector3(0.34, 0.34, 0.2), -0.5);
  addTail(group, new THREE.Vector3(0, 0.24, -0.36), 0.5, 0xd8c4a2, 0.6);
  return group;
}

function buildDog(side: Side) {
  const group = new THREE.Group();
  const body = ellipsoid(0.38, 0.34, 0.42, 0xc59b68);
  body.position.y = 0.36;
  group.add(body);
  addEars(group, new THREE.Vector3(-0.24, 0.6, 0.02), new THREE.Vector3(0.24, 0.6, 0.02), 0.12, 0xa9794a);
  addEyes(group, new THREE.Vector3(-0.12, 0.46, 0.34), new THREE.Vector3(0.12, 0.46, 0.34), 0.055);
  addSnout(group, new THREE.Vector3(0, 0.33, 0.42), 0.17, 0xd6b483);
  addShield(group, new THREE.Vector3(-0.42, 0.38, 0.24), side === 'crimson' ? 0x8c2f25 : 0x2f6f63);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 8, 24), material(0xd5b36b, 0.4, 0.5));
  collar.position.y = 0.52;
  collar.rotation.x = Math.PI / 2;
  group.add(collar);
  addTail(group, new THREE.Vector3(0, 0.25, -0.38), 0.38, 0xc59b68, 0.8);
  return group;
}

function buildWolf(side: Side) {
  const group = new THREE.Group();
  const body = ellipsoid(0.34, 0.32, 0.48, 0x8f9a92);
  body.position.y = 0.36;
  group.add(body);
  addEars(group, new THREE.Vector3(-0.17, 0.64, 0.02), new THREE.Vector3(0.17, 0.64, 0.02), 0.12, 0x6f7d76);
  addEyes(group, new THREE.Vector3(-0.11, 0.46, 0.34), new THREE.Vector3(0.11, 0.46, 0.34), 0.05, 0xd5b36b);
  addSnout(group, new THREE.Vector3(0, 0.33, 0.46), 0.14, 0xa8b0a6);
  const moon = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 8, 20), material(0xd5b36b, 0.35, 0.6));
  moon.position.set(0, 0.62, 0.28);
  moon.rotation.x = Math.PI / 2;
  group.add(moon);
  addTail(group, new THREE.Vector3(0, 0.24, -0.44), 0.56, 0x8f9a92, 0.4);
  addPattern(group, 0.42, 0.34, side === 'crimson' ? 0xc8513f : 0x4f9d8b, 6);
  return group;
}

function buildLeopard(side: Side) {
  const group = new THREE.Group();
  const body = ellipsoid(0.31, 0.3, 0.46, 0xd8b46a);
  body.position.y = 0.34;
  group.add(body);
  addEars(group, new THREE.Vector3(-0.16, 0.58, 0.02), new THREE.Vector3(0.16, 0.58, 0.02), 0.1, 0xc5a05a);
  addEyes(group, new THREE.Vector3(-0.1, 0.43, 0.32), new THREE.Vector3(0.1, 0.43, 0.32), 0.05, 0x6f8f3a);
  addSnout(group, new THREE.Vector3(0, 0.31, 0.42), 0.11, 0xe8ce92);
  addBlade(group, new THREE.Vector3(-0.32, 0.32, 0.2), 0.7);
  addBlade(group, new THREE.Vector3(0.32, 0.32, 0.2), -0.7);
  const random = mulberry32(side === 'crimson' ? 17 : 29);
  for (let index = 0; index < 14; index += 1) {
    const spot = sphere(0.035 + random() * 0.025, 0x2d1d12, 8, 6);
    const angle = random() * Math.PI * 2;
    spot.position.set(Math.cos(angle) * 0.3, 0.25 + random() * 0.25, Math.sin(angle) * 0.42);
    group.add(spot);
  }
  addTail(group, new THREE.Vector3(0, 0.22, -0.42), 0.58, 0xd8b46a, 0.5);
  return group;
}

function buildTiger(side: Side) {
  const group = new THREE.Group();
  const body = ellipsoid(0.38, 0.36, 0.48, 0xd98b45);
  body.position.y = 0.38;
  group.add(body);
  addEars(group, new THREE.Vector3(-0.2, 0.66, 0.02), new THREE.Vector3(0.2, 0.66, 0.02), 0.12, 0xc07535);
  addEyes(group, new THREE.Vector3(-0.12, 0.5, 0.35), new THREE.Vector3(0.12, 0.5, 0.35), 0.06, 0x2b1a10);
  addSnout(group, new THREE.Vector3(0, 0.36, 0.46), 0.15, 0xf0c08a);
  addCloudShoulders(group, 0.38, side === 'crimson' ? 0x8c2f25 : 0x2f6f63);
  for (let index = 0; index < 7; index += 1) {
    const stripe = box(0.36, 0.035, 0.02, 0x2d1a10);
    stripe.position.set(0, 0.18 + index * 0.09, 0.44 - index * 0.012);
    stripe.rotation.z = index % 2 ? 0.2 : -0.2;
    group.add(stripe);
  }
  addTail(group, new THREE.Vector3(0, 0.26, -0.44), 0.56, 0xd98b45, 0.45);
  return group;
}

function buildLion(side: Side) {
  const group = new THREE.Group();
  const body = ellipsoid(0.42, 0.4, 0.5, 0xc98f4d);
  body.position.y = 0.42;
  group.add(body);
  const mane = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 24, 18),
    material(0x8a4a22, 0.9),
  );
  mane.position.set(0, 0.56, 0.08);
  mane.scale.set(1.05, 1.05, 0.85);
  group.add(mane);
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    const tuft = cone(0.09, 0.18, 0x7a3d1c, 8);
    tuft.position.set(Math.cos(angle) * 0.42, 0.56 + Math.sin(angle) * 0.42, 0.08);
    tuft.rotation.z = angle + Math.PI / 2;
    group.add(tuft);
  }
  addEyes(group, new THREE.Vector3(-0.13, 0.56, 0.4), new THREE.Vector3(0.13, 0.56, 0.4), 0.06);
  addSnout(group, new THREE.Vector3(0, 0.42, 0.5), 0.16, 0xe6b878);
  addCape(group, side === 'crimson' ? 0x8c2f25 : 0x2f6f63);
  addArmor(group, 0.62, 0.42, 0xd5b36b);
  addTail(group, new THREE.Vector3(0, 0.28, -0.48), 0.55, 0xc98f4d, 0.4);
  return group;
}

function buildElephant(side: Side) {
  const group = new THREE.Group();
  const body = ellipsoid(0.48, 0.44, 0.54, 0x9aa5a8);
  body.position.y = 0.46;
  group.add(body);
  addEars(group, new THREE.Vector3(-0.42, 0.6, 0.06), new THREE.Vector3(0.42, 0.6, 0.06), 0.28, 0x8b9699);
  addEyes(group, new THREE.Vector3(-0.14, 0.58, 0.42), new THREE.Vector3(0.14, 0.58, 0.42), 0.055);
  addTrunk(group, new THREE.Vector3(0, 0.5, 0.5), 0.72, 0x9aa5a8);
  addTusks(group, new THREE.Vector3(-0.2, 0.44, 0.46), new THREE.Vector3(0.2, 0.44, 0.46));
  addArmor(group, 0.66, 0.5, side === 'crimson' ? 0x8c2f25 : 0x2f6f63);
  addPattern(group, 0.72, 0.46, 0xd5b36b, 8);
  addTail(group, new THREE.Vector3(0, 0.3, -0.5), 0.42, 0x9aa5a8, 0.3);
  return group;
}

const BUILDERS: Record<BeastType, (side: Side) => THREE.Group> = {
  rat: buildRat,
  cat: buildCat,
  dog: buildDog,
  wolf: buildWolf,
  leopard: buildLeopard,
  tiger: buildTiger,
  lion: buildLion,
  elephant: buildElephant,
};

export function createBeast(type: BeastType, side: Side): THREE.Group {
  const group = new THREE.Group();
  group.name = `beast-${side}-${type}`;
  const body = BUILDERS[type](side);
  group.add(body);

  const base = cylinder(0.42, 0.46, 0.12, 0x3b1d12, 32);
  base.position.y = 0.06;
  group.add(base);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.025, 8, 32),
    material(side === 'crimson' ? 0xc8513f : 0x4f9d8b, 0.4, 0.3),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.12;
  group.add(rim);

  const plateTexture = namePlateTexture(BEAST_NAMES[type], RANK[type], side);
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.25),
    new THREE.MeshStandardMaterial({ map: plateTexture, roughness: 0.8 }),
  );
  plate.position.set(0, 0.06, 0.465);
  group.add(plate);
  return group;
}

export function createTrapMarker(): THREE.Group {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.32, 0.035, 8, 32),
    material(0x1d110a, 0.55, 0.25),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);
  const inner = cylinder(0.28, 0.28, 0.025, 0x24130b, 32);
  inner.position.y = 0.02;
  group.add(inner);
  return group;
}

export function createDenMarker(side: Side): THREE.Group {
  const group = new THREE.Group();
  const color = new THREE.Color(SIDE_COLORS[side]);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.36, 0.05, 10, 36),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2, emissive: color, emissiveIntensity: 0.25 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.04;
  group.add(ring);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.06, 10, 24, Math.PI), material(0xd5b36b, 0.35, 0.5));
  arch.position.y = 0.08;
  group.add(arch);
  return group;
}
