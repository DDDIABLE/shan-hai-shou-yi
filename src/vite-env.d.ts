/// <reference types="vite/client" />

export {};

declare global {
  interface Window {
    __shanHaiCamera?: { azimuth: number; polar: number; distance: number };
    __shanHaiMoves?: number;
    __shanHaiScene?: { renders: number; pieces: number; reducedMotion: boolean; orientations?: Record<string, number> };
    __shanHaiAi?: { mode: string; at: number };
    __shanHaiSceneRef?: { current: unknown } | null;
    __shanHaiStep?: () => boolean;
  }
}
