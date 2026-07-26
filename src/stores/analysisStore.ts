import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { FrequencySpectrum, FFTConfig } from '../types/spectrum';
import type { ImpulseResponse, IRDerivationConfig } from '../types/ir';
import type { RecorderConfig, AudioBuffer } from '../types/audio';
import { logger } from '../services/logging';
import { parseWavFile } from '../services/audio/wavParser';
import { computeFFT } from '../services/audio/fftProcessor';
import { extractSpectrum } from '../services/dsp/spectrum';
import { deriveIR } from '../services/dsp/irDerivation';
import { convolveAudio } from '../services/audio/convolution';
import { AudioRecorder } from '../services/audio/recorder';

export const useAnalysisStore = defineStore('analysis', () => {
  const audioBuffers = ref({ A: new Float32Array(), B: new Float32Array() });
  const sampleRates = ref({ A: 44100, B: 44100 });
  const audioHeaders = ref({
    A: null as any,
    B: null as any,
  });
  const selections = ref({
    A: { startSample: 0, endSample: 0, duration: 0 },
    B: { startSample: 0, endSample: 0, duration: 0 },
  });
  const spectra = ref({ A: null as FrequencySpectrum | null, B: null as FrequencySpectrum | null });
  const ir = ref<ImpulseResponse | null>(null);
  const convolved = ref<Float32Array>(new Float32Array());
  const playbackState = ref<'idle' | 'playing' | 'paused'>('idle');
  const recorder = new AudioRecorder();
  let audioContext: AudioContext | null = null;
  let playbackSource: AudioBufferSourceNode | null = null;

  async function loadFile(file: File, slot: 'A' | 'B'): Promise<void> {
    logger.info('analysisStore', 'Loading file', { slot, fileName: file.name });

    const parsed: AudioBuffer = await parseWavFile(file);
    audioBuffers.value[slot] = parsed.audioData;
    audioHeaders.value[slot] = parsed.header;
    sampleRates.value[slot] = parsed.header.sampleRate;

    // Reset selection to full range
    selections.value[slot] = {
      startSample: 0,
      endSample: parsed.audioData.length,
      duration: parsed.header.duration * 1000,
    };

    logger.info('analysisStore', `File ${slot} loaded`, {
      samples: parsed.audioData.length,
      sampleRate: parsed.header.sampleRate,
    });
  }

  async function recordAudio(config: RecorderConfig): Promise<void> {
    logger.info('analysisStore', 'Starting recording');
    await recorder.start(config);
  }

  async function stopRecording(): Promise<void> {
    logger.info('analysisStore', 'Stopping recording');
    const audioData = await recorder.stop();
    const sr = 44100; // Recorder uses 44100 Hz

    audioBuffers.value.A = audioData;
    audioHeaders.value.A = {
      sampleRate: sr,
      channels: 1,
      bitDepth: 32,
      duration: audioData.length / sr,
    };
    sampleRates.value.A = sr;

    selections.value.A = {
      startSample: 0,
      endSample: audioData.length,
      duration: audioHeaders.value.A.duration * 1000,
    };

    logger.info('analysisStore', 'Recording saved', {
      samples: audioData.length,
      sampleRate: sr,
    });
  }

  function updateSelection(slot: 'A' | 'B', startSample: number, endSample: number): void {
    const sampleRate = audioHeaders.value[slot]?.sampleRate || 44100;
    const duration = ((endSample - startSample) / sampleRate) * 1000;

    selections.value[slot] = { startSample, endSample, duration };
    logger.debug('analysisStore', `Selection updated: ${slot}`, {
      startSample,
      endSample,
      duration: duration.toFixed(0) + 'ms',
    });
  }

  async function computeSpectra(config: FFTConfig): Promise<void> {
    logger.info('analysisStore', 'Computing spectra', { fftSize: config.fftSize });

    if (audioBuffers.value.A.length === 0 || audioBuffers.value.B.length === 0) {
      throw new Error('Both audio files must be loaded before computing spectra');
    }

    // Extract selected regions
    const signalA = audioBuffers.value.A.slice(
      selections.value.A.startSample,
      selections.value.A.endSample,
    );
    const signalB = audioBuffers.value.B.slice(
      selections.value.B.startSample,
      selections.value.B.endSample,
    );

    const fftResultA = computeFFT(signalA, config, sampleRates.value.A);
    const fftResultB = computeFFT(signalB, config, sampleRates.value.B);

    spectra.value.A = extractSpectrum(fftResultA);
    spectra.value.B = extractSpectrum(fftResultB);

    logger.info('analysisStore', 'Spectra computed', {
      binsA: spectra.value.A.frequencies.length,
      binsB: spectra.value.B.frequencies.length,
      sampleRateA: sampleRates.value.A,
      sampleRateB: sampleRates.value.B,
    });
  }

  async function computeIR(config: IRDerivationConfig): Promise<void> {
    logger.info('analysisStore', 'Computing IR', { method: config.method });

    if (!spectra.value.A || !spectra.value.B) {
      throw new Error('Spectra must be computed before deriving IR');
    }

    ir.value = deriveIR(spectra.value.A, spectra.value.B, config);
    logger.info('analysisStore', 'IR computed', { length: ir.value.length });
  }

  async function applyIR(): Promise<void> {
    logger.info('analysisStore', 'Applying IR');

    if (!ir.value) {
      throw new Error('IR must be computed before applying');
    }

    convolved.value = convolveAudio({
      irCoefficients: ir.value.coefficients,
      audioData: audioBuffers.value.A,
      sampleRate: audioHeaders.value.A?.sampleRate || 44100,
    });

    logger.info('analysisStore', 'IR applied', { outputLength: convolved.value.length });
  }

  async function playback(volume: number): Promise<void> {
    logger.info('analysisStore', 'Starting playback', { volume });

    if (convolved.value.length === 0) {
      throw new Error('No audio to play');
    }

    const sampleRate = audioHeaders.value.A?.sampleRate || 44100;

    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate,
      });
    }

    const buffer = audioContext.createBuffer(
      1,
      convolved.value.length,
      sampleRate,
    );
    buffer.getChannelData(0).set(convolved.value);

    const gainNode = audioContext.createGain();
    gainNode.gain.value = Math.max(0, Math.min(1, volume));

    playbackSource = audioContext.createBufferSource();
    playbackSource.buffer = buffer;
    playbackSource.connect(gainNode);
    gainNode.connect(audioContext.destination);

    playbackSource.onended = () => {
      playbackState.value = 'idle';
      logger.info('analysisStore', 'Playback ended');
    };

    playbackSource.start(0);
    playbackState.value = 'playing';
  }

  async function stopPlayback(): Promise<void> {
    if (playbackSource) {
      playbackSource.stop();
      playbackState.value = 'idle';
      logger.info('analysisStore', 'Playback stopped');
    }
  }

  return {
    audioBuffers,
    audioHeaders,
    sampleRates,
    selections,
    spectra,
    ir,
    convolved,
    playbackState,
    recorder,
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
