import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { FrequencySpectrum } from '../types/spectrum';
import type { ImpulseResponse, IRDerivationConfig } from '../types/ir';
import type { FFTConfig, RecorderConfig } from '../types/audio';

export const useAnalysisStore = defineStore('analysis', () => {
  const audioBuffers = ref({ A: new Float32Array(), B: new Float32Array() });
  const selections = ref({
    A: { startSample: 0, endSample: 0, duration: 0 },
    B: { startSample: 0, endSample: 0, duration: 0 },
  });
  const spectra = ref({ A: null as FrequencySpectrum | null, B: null as FrequencySpectrum | null });
  const ir = ref<ImpulseResponse | null>(null);
  const convolved = ref<Float32Array>(new Float32Array());
  const playbackState = ref<'idle' | 'playing' | 'paused'>('idle');
  const recordingState = ref<'idle' | 'recording' | 'paused'>('idle');

  async function loadFile(file: File, slot: 'A' | 'B'): Promise<void> {
    throw new Error('Not implemented');
  }

  async function recordAudio(config: RecorderConfig): Promise<void> {
    throw new Error('Not implemented');
  }

  async function stopRecording(): Promise<void> {
    throw new Error('Not implemented');
  }

  function updateSelection(slot: 'A' | 'B', startSample: number, endSample: number): void {
    throw new Error('Not implemented');
  }

  async function computeSpectra(config: FFTConfig): Promise<void> {
    throw new Error('Not implemented');
  }

  async function computeIR(config: IRDerivationConfig): Promise<void> {
    throw new Error('Not implemented');
  }

  async function applyIR(): Promise<void> {
    throw new Error('Not implemented');
  }

  async function playback(volume: number): Promise<void> {
    throw new Error('Not implemented');
  }

  async function stopPlayback(): Promise<void> {
    throw new Error('Not implemented');
  }

  return {
    audioBuffers,
    selections,
    spectra,
    ir,
    convolved,
    playbackState,
    recordingState,
    loadFile,
    recordAudio,
    stopRecording,
    updateSelection,
    computeSpectra,
    computeIR,
    applyIR,
    playback,
    stopPlayback,
  };
});
