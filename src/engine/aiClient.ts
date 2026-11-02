import { chooseAiMove } from './ai';
import type { AiDifficulty, AiRequest, AiResponse, GameState, Move } from './types';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (move: Move | null) => void; reject: (error: Error) => void }>();
let supportsWorker = typeof window !== 'undefined' && 'Worker' in window;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<AiResponse>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      if (event.data.error) {
        mark('worker-error');
        entry.reject(new Error(event.data.error));
      } else {
        mark('worker-ok');
        entry.resolve(event.data.move);
      }
    };
    worker.onerror = () => {
      mark('worker-onerror');
      supportsWorker = false;
      for (const entry of pending.values()) entry.reject(new Error('AI Worker 不可用'));
      pending.clear();
    };
  }
  return worker;
}

function mark(mode: string) {
  if (typeof window !== 'undefined') {
    window.__shanHaiAi = { mode, at: Date.now() };
  }
}

export function requestAiMove(
  state: GameState,
  difficulty: AiDifficulty,
  seed: number,
  timeoutMs = 12000,
): Promise<Move | null> {
  mark('request');
  if (!supportsWorker) {
    mark('fallback-sync');
    return new Promise((resolve) => {
      setTimeout(() => resolve(chooseAiMove(state, { difficulty, seed })), 0);
    });
  }
  const id = nextId++;
  const request: AiRequest = { id, state, difficulty, seed };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      supportsWorker = false;
      worker?.terminate();
      worker = null;
      mark('fallback-timeout');
      resolve(chooseAiMove(state, { difficulty, seed }));
    }, timeoutMs);
    pending.set(id, {
      resolve: (move) => {
        clearTimeout(timer);
        resolve(move);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    try {
      getWorker().postMessage(request);
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      mark('fallback-post');
      resolve(chooseAiMove(state, { difficulty, seed }));
    }
  });
}

export function terminateAiWorker() {
  worker?.terminate();
  worker = null;
  pending.clear();
}
