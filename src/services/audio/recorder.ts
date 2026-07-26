import type { RecorderConfig, RecorderState } from '../../types/audio';

export class AudioRecorder {
  async start(config: RecorderConfig): Promise<void> {
    throw new Error('Not implemented');
  }

  async stop(): Promise<Float32Array> {
    throw new Error('Not implemented');
  }

  pause(): void {
    throw new Error('Not implemented');
  }

  resume(): void {
    throw new Error('Not implemented');
  }

  getRecordedDuration(): number {
    throw new Error('Not implemented');
  }

  getCurrentLevel(): number {
    throw new Error('Not implemented');
  }

  getState(): RecorderState {
    throw new Error('Not implemented');
  }
}
