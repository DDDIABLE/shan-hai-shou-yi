import { describe, expect, it } from 'vitest';
import {
  applyMove,
  createGame,
  getLegalMoves,
  hashPosition,
  isEnemyDen,
  isWater,
  notationForMove,
  pieceAt,
  undo,
} from './board';
import type { BeastType, GameState, Move, Piece, Pos, Side } from './types';

function onlyMove(state: GameState, from: Pos, to: Pos): Move {
  const moves = getLegalMoves(state).filter(
    (move) => move.from.x === from.x && move.from.y === from.y && move.to.x === to.x && move.to.y === to.y,
  );
  expect(moves).toHaveLength(1);
  return moves[0];
}

function emptyState(turn: Side = 'crimson'): GameState {
  return {
    ...createGame(),
    board: Array.from({ length: 63 }, () => ({ piece: null })),
    turn,
    history: [],
    positionCounts: {},
    noCapturePlies: 0,
    ply: 0,
    result: null,
  };
}

function stateWith(pieces: Array<[BeastType, Side, number, number]>, turn: Side = 'crimson'): GameState {
  const state = emptyState(turn);
  for (const [type, side, x, y] of pieces) {
    state.board[y * 7 + x].piece = { id: `${side}-${type}-${x}-${y}`, type, side };
  }
  return state;
}

function perft(state: GameState, depth: number): number {
  if (depth === 0) return 1;
  const moves = getLegalMoves(state);
  if (depth === 1) return moves.length;
  let total = 0;
  for (const move of moves) total += perft(applyMove(state, move).state, depth - 1);
  return total;
}

describe('棋盘与初始摆位', () => {
  it('完整初始摆位为 7×9，双方各八兽', () => {
    const state = createGame();
    expect(state.board).toHaveLength(63);
    expect(state.board.filter((cell) => cell.piece)).toHaveLength(16);
    expect(pieceAt(state.board, { x: 0, y: 0 })?.type).toBe('lion');
    expect(pieceAt(state.board, { x: 6, y: 8 })?.type).toBe('lion');
  });

  it('perft 精确匹配 24 / 576 / 12240', () => {
    const state = createGame();
    expect(perft(state, 1)).toBe(24);
    expect(perft(state, 2)).toBe(576);
    expect(perft(state, 3)).toBe(12240);
  });
});

describe('基本移动与吃子', () => {
  it('正交单步', () => {
    const state = stateWith([['dog', 'crimson', 3, 4]]);
    const moves = getLegalMoves(state, { x: 3, y: 4 });
    expect(moves.map((move) => `${move.to.x},${move.to.y}`).sort()).toEqual(['3,3', '3,5']);
  });

  it('普通等级吃子、同级互吃、低不能吃高', () => {
    const tiger = stateWith([['tiger', 'crimson', 3, 4], ['wolf', 'teal', 3, 3]]);
    expect(getLegalMoves(tiger, { x: 3, y: 4 }).some((move) => move.to.x === 3 && move.to.y === 3)).toBe(true);
    const equal = stateWith([['wolf', 'crimson', 3, 4], ['wolf', 'teal', 3, 3]]);
    expect(getLegalMoves(equal, { x: 3, y: 4 }).some((move) => move.to.x === 3 && move.to.y === 3)).toBe(true);
    const weak = stateWith([['cat', 'crimson', 3, 4], ['wolf', 'teal', 3, 3]]);
    expect(getLegalMoves(weak, { x: 3, y: 4 }).some((move) => move.to.x === 3 && move.to.y === 3)).toBe(false);
  });

  it('陆地鼠吃象，象不能吃鼠', () => {
    const ratElephant = stateWith([['rat', 'crimson', 3, 4], ['elephant', 'teal', 3, 3]]);
    expect(getLegalMoves(ratElephant, { x: 3, y: 4 }).some((move) => move.to.x === 3 && move.to.y === 3)).toBe(true);
    const elephantRat = stateWith([['elephant', 'crimson', 3, 4], ['rat', 'teal', 3, 3]]);
    expect(getLegalMoves(elephantRat, { x: 3, y: 4 }).some((move) => move.to.x === 3 && move.to.y === 3)).toBe(false);
  });
});

describe('水域', () => {
  it('只有鼠能入水', () => {
    expect(isWater({ x: 1, y: 3 })).toBe(true);
    const tiger = stateWith([['tiger', 'crimson', 3, 3]]);
    expect(getLegalMoves(tiger, { x: 3, y: 3 }).some((move) => move.to.x === 2 && move.to.y === 3)).toBe(false);
    const rat = stateWith([['rat', 'crimson', 3, 3]]);
    expect(getLegalMoves(rat, { x: 3, y: 3 }).some((move) => move.to.x === 2 && move.to.y === 3)).toBe(true);
  });

  it('鼠进出水域那一步不能吃子', () => {
    const rat = stateWith([['rat', 'crimson', 1, 2], ['cat', 'teal', 1, 3]]);
    expect(getLegalMoves(rat, { x: 1, y: 2 }).some((move) => move.to.x === 1 && move.to.y === 3)).toBe(false);
    const leaving = stateWith([['rat', 'crimson', 1, 3], ['cat', 'teal', 1, 2]]);
    expect(getLegalMoves(leaving, { x: 1, y: 3 }).some((move) => move.to.x === 1 && move.to.y === 2)).toBe(false);
  });

  it('水中鼠只能被水中鼠吃', () => {
    const cat = stateWith([['rat', 'crimson', 1, 3], ['cat', 'teal', 1, 2]]);
    expect(getLegalMoves(cat, { x: 1, y: 2 }).some((move) => move.to.x === 1 && move.to.y === 3)).toBe(false);
    const rats = stateWith([['rat', 'crimson', 1, 3], ['rat', 'teal', 2, 3]], 'teal');
    expect(getLegalMoves(rats, { x: 2, y: 3 }).some((move) => move.to.x === 1 && move.to.y === 3)).toBe(true);
  });
});

describe('狮虎跃河', () => {
  it('横向与纵向跃河', () => {
    const lion = stateWith([['lion', 'crimson', 0, 3]]);
    expect(getLegalMoves(lion, { x: 0, y: 3 }).some((move) => move.to.x === 3 && move.to.y === 3 && move.kind === 'jump')).toBe(true);
    const tiger = stateWith([['tiger', 'crimson', 1, 2]]);
    expect(getLegalMoves(tiger, { x: 1, y: 2 }).some((move) => move.to.x === 1 && move.to.y === 6 && move.kind === 'jump')).toBe(true);
  });

  it('路径有鼠则不能跳', () => {
    const lion = stateWith([['lion', 'crimson', 0, 3], ['rat', 'teal', 1, 3]]);
    expect(getLegalMoves(lion, { x: 0, y: 3 }).some((move) => move.to.x === 3 && move.to.y === 3)).toBe(false);
    const ownRat = stateWith([['lion', 'crimson', 0, 3], ['rat', 'crimson', 1, 3]]);
    expect(getLegalMoves(ownRat, { x: 0, y: 3 }).some((move) => move.to.x === 3 && move.to.y === 3)).toBe(false);
  });
});

describe('陷阱与兽穴', () => {
  it('敌陷阱降级，离开恢复', () => {
    const state = stateWith([['dog', 'crimson', 4, 8], ['elephant', 'teal', 3, 7], ['tiger', 'teal', 3, 8]]);
    const trapped = getLegalMoves(state, { x: 4, y: 8 });
    expect(trapped.some((move) => move.to.x === 3 && move.to.y === 8)).toBe(false);
    const moved = applyMove(state, onlyMove(state, { x: 4, y: 8 }, { x: 4, y: 7 })).state;
    expect(getLegalMoves({ ...moved, turn: 'crimson' }, { x: 4, y: 7 }).some((move) => move.to.x === 3 && move.to.y === 7)).toBe(true);
  });

  it('禁止进入己方兽穴，进入敌方兽穴获胜', () => {
    const dog = stateWith([['dog', 'crimson', 3, 7]]);
    expect(getLegalMoves(dog, { x: 3, y: 7 }).some((move) => move.to.x === 3 && move.to.y === 8)).toBe(false);
    const raider = stateWith([['rat', 'crimson', 3, 1]]);
    const result = applyMove(raider, onlyMove(raider, { x: 3, y: 1 }, { x: 3, y: 0 }));
    expect(result.state.result).toEqual({ status: 'win', winner: 'crimson', reason: 'den' });
    expect(isEnemyDen('crimson', { x: 3, y: 0 })).toBe(true);
  });
});

describe('终局、记谱与撤回', () => {
  it('无合法着法判负', () => {
    const state = stateWith([
      ['cat', 'teal', 3, 4],
      ['tiger', 'crimson', 2, 4],
      ['tiger', 'crimson', 4, 4],
      ['tiger', 'crimson', 3, 3],
      ['tiger', 'crimson', 3, 5],
    ]);
    expect(getLegalMoves({ ...state, turn: 'teal' })).toHaveLength(0);
  });

  it('三次重复判和', () => {
    let state = stateWith([['dog', 'crimson', 3, 4], ['cat', 'teal', 2, 2]]);
    state.positionCounts = {};
    const cycle: Array<[Pos, Pos]> = [
      [{ x: 3, y: 4 }, { x: 3, y: 3 }],
      [{ x: 2, y: 2 }, { x: 1, y: 2 }],
      [{ x: 3, y: 3 }, { x: 3, y: 4 }],
      [{ x: 1, y: 2 }, { x: 2, y: 2 }],
      [{ x: 3, y: 4 }, { x: 3, y: 3 }],
      [{ x: 2, y: 2 }, { x: 1, y: 2 }],
      [{ x: 3, y: 3 }, { x: 3, y: 4 }],
      [{ x: 1, y: 2 }, { x: 2, y: 2 }],
      [{ x: 3, y: 4 }, { x: 3, y: 3 }],
    ];
    for (const [from, to] of cycle) {
      state = applyMove(state, onlyMove(state, from, to)).state;
    }
    expect(state.positionCounts[hashPosition(state.board, state.turn)]).toBeGreaterThanOrEqual(3);
    expect(state.result).toEqual({ status: 'draw', reason: 'repetition' });
  });

  it('连续 100 个无吃子半回合判和', () => {
    let state = stateWith([['dog', 'crimson', 3, 4], ['cat', 'teal', 2, 2]]);
    state.noCapturePlies = 99;
    state = applyMove(state, onlyMove(state, { x: 3, y: 4 }, { x: 3, y: 3 })).state;
    expect(state.result).toEqual({ status: 'draw', reason: 'no-capture' });
  });

  it('中文记谱', () => {
    const state = stateWith([['lion', 'crimson', 3, 4], ['cat', 'teal', 3, 3]]);
    const move = onlyMove(state, { x: 3, y: 4 }, { x: 3, y: 3 });
    const mover: Piece = { id: 'crimson-lion', type: 'lion', side: 'crimson' };
    const captured: Piece = { id: 'teal-cat', type: 'cat', side: 'teal' };
    expect(notationForMove(move, mover, captured)).toBe('赤·狮 3,4行3,3 × 苍·猫');
  });

  it('撤回后完整恢复', () => {
    let state = createGame();
    state = applyMove(state, onlyMove(state, { x: 6, y: 8 }, { x: 5, y: 8 })).state;
    state = applyMove(state, onlyMove(state, { x: 0, y: 0 }, { x: 1, y: 0 })).state;
    const restored = undo(state, 2);
    expect(restored.ply).toBe(0);
    expect(restored.turn).toBe('crimson');
    expect(restored.noCapturePlies).toBe(0);
    expect(restored.positionCounts).toEqual(createGame().positionCounts);
    expect(restored.history).toHaveLength(0);
  });
});
