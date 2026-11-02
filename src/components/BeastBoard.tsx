import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { BeastScene } from '../scene/BeastScene';
import type { GameState, MoveEvent, Pos } from '../engine/types';

type Props = {
  state: GameState;
  selected: Pos | null;
  legalTargets: Pos[];
  reducedMotion: boolean;
  lastEvent: MoveEvent | null;
  onCellClick: (pos: Pos) => void;
  onCameraChange?: (azimuth: number, polar: number, distance: number) => void;
  sceneRef?: RefObject<BeastScene | null>;
};

export function BeastBoard({ state, selected, legalTargets, reducedMotion, lastEvent, onCellClick, onCameraChange, sceneRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const innerSceneRef = useRef<BeastScene | null>(null);
  const lastEventRef = useRef<MoveEvent | null>(null);
  const clickRef = useRef(onCellClick);
  const cameraRef = useRef(onCameraChange);
  clickRef.current = onCellClick;
  cameraRef.current = onCameraChange;

  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new BeastScene(canvasRef.current, { reducedMotion });
    innerSceneRef.current = scene;
    if (sceneRef) sceneRef.current = scene;
    scene.onCellClick = (pos) => clickRef.current(pos);
    scene.onCameraChange = (azimuth, polar, distance) => cameraRef.current?.(azimuth, polar, distance);
    scene.syncBoard(state);
    const observer = new ResizeObserver(() => scene.resize());
    observer.observe(canvasRef.current.parentElement as Element);
    return () => {
      observer.disconnect();
      scene.dispose();
      innerSceneRef.current = null;
      if (sceneRef) sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    innerSceneRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    const scene = innerSceneRef.current;
    if (!scene) return;
    scene.syncBoard(state, true);
    const pending = lastEventRef.current;
    if (pending) {
      lastEventRef.current = null;
      scene.playMove(pending);
    }
  }, [state]);

  useEffect(() => {
    if (!lastEvent) return;
    lastEventRef.current = lastEvent;
    const scene = innerSceneRef.current;
    if (!scene) return;
    scene.playMove(lastEvent);
    lastEventRef.current = null;
  }, [lastEvent]);

  useEffect(() => {
    const scene = innerSceneRef.current;
    if (!scene) return;
    scene.showSelection(selected);
    scene.showLegalMoves(legalTargets);
  }, [selected, legalTargets]);

  return (
    <div className="beast-board-wrap">
      <canvas
        ref={canvasRef}
        className="beast-canvas"
        data-testid="beast-canvas"
        aria-label="山海兽弈三维棋盘，可拖拽旋转，滚轮或双指缩放"
        role="img"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (selected) onCellClick(selected);
          }
        }}
      />
      <div className="scene-hint" aria-hidden="true">拖拽旋转 · 滚轮缩放</div>
    </div>
  );
}
