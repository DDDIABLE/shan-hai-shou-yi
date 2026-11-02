import { chooseAiMove } from './ai';
import type { AiRequest, AiResponse } from './types';

export interface AiWorkerScope {
  onmessage: ((event: MessageEvent<AiRequest>) => void) | null;
  postMessage(message: AiResponse): void;
}

const scope = self as unknown as AiWorkerScope;

scope.onmessage = (event: MessageEvent<AiRequest>) => {
  const request = event.data;
  try {
    const move = chooseAiMove(request.state, {
      difficulty: request.difficulty,
      seed: request.seed,
    });
    const response: AiResponse = { id: request.id, move };
    scope.postMessage(response);
  } catch (error) {
    const response: AiResponse = {
      id: request.id,
      move: null,
      error: error instanceof Error ? error.message : 'AI 计算失败',
    };
    scope.postMessage(response);
  }
};
