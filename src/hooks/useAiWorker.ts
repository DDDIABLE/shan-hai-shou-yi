import { useCallback, useEffect, useRef } from 'react';
import { requestAiMove, terminateAiWorker } from '../engine/aiClient';
import type { AiDifficulty, GameState, Move } from '../engine/types';

export function useAiWorker() {
  const active = useRef(false);
  useEffect(() => () => terminateAiWorker(), []);
  return useCallback(
    async (state: GameState, difficulty: AiDifficulty, seed: number): Promise<Move | null> => {
      if (active.current) return null;
      active.current = true;
      try {
        return await requestAiMove(state, difficulty, seed);
      } finally {
        active.current = false;
      }
    },
    [],
  );
}
