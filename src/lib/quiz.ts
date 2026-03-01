import type { QuizState, QuizMode } from './types.js';

export function formatName(id: string): string {
  // Remove region prefix for display (e.g. "usa:texas" → "Texas")
  const base = id.includes(':') ? id.split(':').pop()! : id;
  return base
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createQuiz(region: string, mode: QuizMode, ids: string[]): QuizState {
  const queue = shuffle(ids.filter((id) => id));
  return {
    region,
    mode,
    queue,
    currentIndex: 0,
    score: 0,
    phase: 'asking',
    targetId: queue[0] ?? '',
    clickedId: ''
  };
}

export function handleAnswer(state: QuizState, clickedId: string): QuizState {
  const correct = clickedId === state.targetId;
  return {
    ...state,
    phase: correct ? 'feedback-correct' : 'feedback-wrong',
    clickedId,
    score: correct ? state.score + 1 : state.score
  };
}

export function advance(state: QuizState): QuizState {
  const nextIndex = state.currentIndex + 1;
  if (nextIndex >= state.queue.length) {
    return { ...state, phase: 'done', clickedId: '' };
  }
  return {
    ...state,
    currentIndex: nextIndex,
    targetId: state.queue[nextIndex],
    phase: 'asking',
    clickedId: ''
  };
}
