import {
  applyMove,
  BEAST_VALUES,
  enemyDenOf,
  getLegalMoves,
  isEnemyTrap,
  isWater,
  pieceAt,
} from './board';
import type { AiDifficulty, BeastType, GameState, Move, Pos, Side } from './types';

export const AI_CONFIG = {
  easy: { maxDepth: 1, nodeBudget: 1500 },
  normal: { maxDepth: 3, nodeBudget: 12000 },
  hard: { maxDepth: 5, nodeBudget: 32000 },
} as const;

const PIECE_VALUE: Record<BeastType, number> = BEAST_VALUES;

function distanceToDen(pos: Pos, side: Side): number {
  const den = enemyDenOf(side);
  return Math.abs(pos.x - den.x) + Math.abs(pos.y - den.y);
}

function signedScore(state: GameState, perspective: Side): number {
  if (state.result) {
    if (state.result.status === 'draw') return 0;
    const winner = state.result.winner ?? perspective;
    return winner === perspective ? 100000 : -100000;
  }

  let score = 0;
  for (let y = 0; y < 9; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      const piece = pieceAt(state.board, { x, y });
      if (!piece) continue;
      const sign = piece.side === perspective ? 1 : -1;
      const base = PIECE_VALUE[piece.type];
      const denDistance = distanceToDen({ x, y }, piece.side);
      const advance = (piece.side === 'teal' ? y : 8 - y) * 8;
      const mobility = getLegalMoves({ ...state, turn: piece.side, result: null }).length * 12;
      const waterBonus = piece.type === 'rat' && isWater({ x, y }) ? 70 : 0;
      const trapPenalty = isEnemyTrap(piece.side, { x, y }) ? -Math.floor(base * 0.72) : 0;
      const elephantNearRat = piece.type === 'elephant' ? -14 : 0;
      const ratNearElephant = piece.type === 'rat' ? 12 : 0;
      score += sign * (base + advance + mobility + waterBonus + trapPenalty + elephantNearRat + ratNearElephant - denDistance * 4);
    }
  }
  return score;
}

function orderMoves(moves: Move[], seed: number): Move[] {
  return moves
    .map((move, index) => {
      const stable = ((seed ^ (index * 2654435761)) >>> 0) % 997;
      const captureBonus = move.capturedId ? 100000 : 0;
      const jumpBonus = move.kind === 'jump' ? 500 : 0;
      return { move, key: captureBonus + jumpBonus + stable };
    })
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.move);
}

function search(
  state: GameState,
  depth: number,
  maxDepth: number,
  alpha: number,
  beta: number,
  perspective: Side,
  seed: number,
  counter: { nodes: number; budget: number },
  cache: Map<string, { depth: number; score: number }>,
): number {
  counter.nodes += 1;
  if (counter.nodes >= counter.budget) return signedScore(state, perspective);
  if (state.result || depth === 0) return signedScore(state, perspective);

  const cacheKey = `${state.turn === 'crimson' ? 'C' : 'T'}:${state.board
    .map((cell) => cell.piece ? `${cell.piece.side[0]}${cell.piece.type[0]}` : '..')
    .join('')}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.depth >= depth) return cached.score;

  const moves = orderMoves(getLegalMoves(state), seed + depth * 131 + counter.nodes);
  if (moves.length === 0) return signedScore(state, perspective);

  const maximizing = state.turn === perspective;
  let best = maximizing ? -Infinity : Infinity;
  let localAlpha = alpha;
  let localBeta = beta;

  for (const move of moves) {
    const next = applyMove(state, move).state;
    const score = search(next, depth - 1, maxDepth, localAlpha, localBeta, perspective, seed, counter, cache);
    if (maximizing) {
      best = Math.max(best, score);
      localAlpha = Math.max(localAlpha, best);
    } else {
      best = Math.min(best, score);
      localBeta = Math.min(localBeta, best);
    }
    if (localBeta <= localAlpha) break;
    if (counter.nodes >= counter.budget) break;
  }

  cache.set(cacheKey, { depth, score: best });
  return best;
}

export function chooseAiMove(
  state: GameState,
  options: { difficulty: AiDifficulty; seed: number },
): Move | null {
  if (state.result) return null;
  const moves = getLegalMoves(state);
  if (moves.length === 0) return null;

  const config = AI_CONFIG[options.difficulty];
  const counter = { nodes: 0, budget: config.nodeBudget };
  const cache = new Map<string, { depth: number; score: number }>();
  const ordered = orderMoves(moves, options.seed);
  let bestScore = -Infinity;
  let bestMoves: Move[] = [];

  for (const move of ordered) {
    const next = applyMove(state, move).state;
    const score = search(
      next,
      config.maxDepth - 1,
      config.maxDepth,
      -Infinity,
      Infinity,
      state.turn,
      options.seed,
      counter,
      cache,
    );
    if (score > bestScore + 0.0001) {
      bestScore = score;
      bestMoves = [move];
    } else if (Math.abs(score - bestScore) <= 0.0001) {
      bestMoves.push(move);
    }
    if (counter.nodes >= counter.budget) break;
  }

  if (bestMoves.length === 0) return ordered[0] ?? null;
  const stableIndex = ((options.seed >>> 0) + bestMoves.length * 2654435761) % bestMoves.length;
  return bestMoves[stableIndex] ?? ordered[0];
}

export function evaluateState(state: GameState, perspective: Side): number {
  return signedScore(state, perspective);
}
