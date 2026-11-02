import { describe, expect, it } from 'vitest';
import { chooseAiMove } from './ai';
import { applyMove, createGame, getLegalMoves } from './board';
import type { GameState, Move } from './types';

function isLegal(state: GameState, move: Move): boolean {
  return getLegalMoves(state).some(
    (legal) => legal.from.x === move.from.x && legal.from.y === move.from.y && legal.to.x === move.to.x && legal.to.y === move.to.y,
  );
}

describe('确定性 AI', () => {
  it('三档难度都返回合法着法', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const state = createGame({ difficulty });
      const move = chooseAiMove(state, { difficulty, seed: 42 });
      expect(move).not.toBeNull();
      expect(isLegal(state, move as Move)).toBe(true);
    }
  });

  it('搜索不修改输入状态', () => {
    const state = createGame();
    const before = structuredClone(state);
    chooseAiMove(state, { difficulty: 'hard', seed: 7 });
    expect(state).toEqual(before);
  });

  it('相同种子完全复现，不同种子可改变同分选择', { timeout: 30000 }, () => {
    const state = createGame();
    const first = chooseAiMove(state, { difficulty: 'normal', seed: 123 });
    const second = chooseAiMove(state, { difficulty: 'normal', seed: 123 });
    expect(first).toEqual(second);

    const alternatives = new Set<string>();
    for (let seed = 1; seed <= 8; seed += 1) {
      const move = chooseAiMove(state, { difficulty: 'normal', seed });
      alternatives.add(`${move?.from.x},${move?.from.y}:${move?.to.x},${move?.to.y}`);
    }
    expect(alternatives.size).toBeGreaterThan(1);
  });

  it('终局状态返回 null', () => {
    const state = createGame();
    const finished: GameState = { ...state, result: { status: 'draw', reason: 'no-capture' } };
    expect(chooseAiMove(finished, { difficulty: 'easy', seed: 1 })).toBeNull();
  });

  it('相同种子的一整局 AI 对 AI 可复现', { timeout: 30000 }, () => {
    function play(seed: number): string {
      let state = createGame({ mode: 'watch', seed });
      while (!state.result && state.ply < 24) {
        const move = chooseAiMove(state, { difficulty: 'normal', seed: seed + state.ply });
        if (!move) break;
        state = applyMove(state, move).state;
      }
      return state.history.map((entry) => entry.notation).join('|');
    }
    expect(play(99)).toBe(play(99));
  });
});
