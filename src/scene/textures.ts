import * as THREE from 'three';

export function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建 2D 画布');
  return { canvas, context };
}

export function woodTexture(seed = 1): THREE.CanvasTexture {
  const { canvas, context } = makeCanvas(512, 512);
  const random = mulberry32(seed);
  const gradient = context.createLinearGradient(0, 0, 512, 512);
  gradient.addColorStop(0, '#6b3f22');
  gradient.addColorStop(0.5, '#8a522c');
  gradient.addColorStop(1, '#5a331d');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);
  for (let index = 0; index < 90; index += 1) {
    context.strokeStyle = `rgba(38, 18, 8, ${0.08 + random() * 0.16})`;
    context.lineWidth = 1 + random() * 4;
    context.beginPath();
    const y = random() * 512;
    context.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) {
      context.lineTo(x, y + Math.sin(x * 0.02 + index) * 8 + random() * 3);
    }
    context.stroke();
  }
  for (let index = 0; index < 24; index += 1) {
    context.fillStyle = `rgba(210, 168, 100, ${0.03 + random() * 0.05})`;
    context.beginPath();
    context.ellipse(random() * 512, random() * 512, 20 + random() * 50, 8 + random() * 20, random() * 3, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function stoneTexture(seed = 7): THREE.CanvasTexture {
  const { canvas, context } = makeCanvas(256, 256);
  const random = mulberry32(seed);
  context.fillStyle = '#6d7d6f';
  context.fillRect(0, 0, 256, 256);
  for (let index = 0; index < 900; index += 1) {
    context.fillStyle = `rgba(${180 + random() * 40}, ${190 + random() * 30}, ${170 + random() * 30}, ${0.05 + random() * 0.12})`;
    context.beginPath();
    context.arc(random() * 256, random() * 256, 1 + random() * 4, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function paperTexture(seed = 21): THREE.CanvasTexture {
  const { canvas, context } = makeCanvas(256, 256);
  const random = mulberry32(seed);
  context.fillStyle = '#e8dcc2';
  context.fillRect(0, 0, 256, 256);
  for (let index = 0; index < 500; index += 1) {
    context.fillStyle = `rgba(120, 95, 55, ${0.03 + random() * 0.05})`;
    context.fillRect(random() * 256, random() * 256, 1 + random() * 2, 1 + random() * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function sealTexture(text: string, color = '#c8513f'): THREE.CanvasTexture {
  const { canvas, context } = makeCanvas(256, 256);
  context.fillStyle = '#e8dcc2';
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = color;
  context.lineWidth = 12;
  context.strokeRect(18, 18, 220, 220);
  context.fillStyle = color;
  context.font = 'bold 150px "Kaiti SC", "STKaiti", "KaiTi", serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 128, 138);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function namePlateTexture(name: string, rank: number, side: 'crimson' | 'teal'): THREE.CanvasTexture {
  const { canvas, context } = makeCanvas(256, 128);
  context.fillStyle = side === 'crimson' ? '#3a1410' : '#10312c';
  context.fillRect(0, 0, 256, 128);
  context.strokeStyle = side === 'crimson' ? '#c8513f' : '#4f9d8b';
  context.lineWidth = 6;
  context.strokeRect(6, 6, 244, 116);
  context.fillStyle = '#e8dcc2';
  context.font = 'bold 64px "Kaiti SC", "STKaiti", "KaiTi", serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(name, 92, 68);
  context.fillStyle = side === 'crimson' ? '#d5b36b' : '#9fd4c7';
  context.font = 'bold 52px "Kaiti SC", "STKaiti", "KaiTi", serif';
  context.fillText(String(rank), 190, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function mulberry32(seed: number) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}
