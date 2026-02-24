/**
 * Singleton that tracks note generation state across screen transitions.
 * Survives NoteScreen unmounting when user navigates away mid-generation.
 */

export type NoteGenStatus = 'idle' | 'waiting' | 'generating' | 'complete' | 'error';

type Listener = (text: string, status: NoteGenStatus) => void;

class NoteGenerationService {
  text = '';
  status: NoteGenStatus = 'idle';
  sessionId: string | null = null;
  private listener: Listener | null = null;
  private completionCallback: ((sessionId: string) => void) | null = null;

  subscribe(listener: Listener) {
    this.listener = listener;
  }

  unsubscribe() {
    this.listener = null;
  }

  setCompletionCallback(cb: (sessionId: string) => void) {
    this.completionCallback = cb;
  }

  updateText(text: string) {
    this.text = text;
    this.listener?.(text, this.status);
  }

  setStatus(status: NoteGenStatus) {
    this.status = status;
    this.listener?.(this.text, status);
  }

  markComplete() {
    this.status = 'complete';
    this.listener?.(this.text, 'complete');
    if (this.sessionId) {
      this.completionCallback?.(this.sessionId);
    }
  }

  isActive(): boolean {
    return this.status === 'waiting' || this.status === 'generating';
  }

  reset() {
    this.text = '';
    this.status = 'idle';
    this.sessionId = null;
  }
}

export const noteGenerationService = new NoteGenerationService();
export default noteGenerationService;
