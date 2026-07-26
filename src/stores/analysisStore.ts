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
  const isAutoComputing = ref(false);
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

    // Auto-compute spectrum for this file
    if (!isAutoComputing.value) {
      isAutoComputing.value = true;
      try {
        const config: FFTConfig = {
          fftSize: 2048,
          window: 'hann',
          overlap: 0.5,
        };
        await computeSpectra(config, slot);
        logger.info('analysisStore', `Spectrum auto-computed for ${slot}`);
      } catch (error) {
        logger.error('analysisStore', `Auto-compute failed for ${slot}`, { error: String(error) });
      } finally {
        isAutoComputing.value = false;
      }
    }
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

  async function computeSpectra(config: FFTConfig, slot?: 'A' | 'B'): Promise<void> {
    logger.info('analysisStore', 'Computing spectra', { fftSize: config.fftSize, slot });

    // If slot specified, compute only that file
    if (slot) {
      const buffer = audioBuffers.value[slot];
      if (buffer.length === 0) {
        throw new Error(`Audio file ${slot} not loaded`);
      }

      const signal = buffer.slice(
        selections.value[slot].startSample,
        selections.value[slot].endSample,
      );

      const minLength = 128;
      if (signal.length < minLength) {
        throw new Error(`Signal ${slot} too short (${signal.length} samples, min ${minLength})`);
      }

      try {
        const fftResult = computeFFT(signal, config, sampleRates.value[slot]);
        spectra.value[slot] = extractSpectrum(fftResult);
        logger.info('analysisStore', `Spectrum ${slot} computed`, {
          bins: spectra.value[slot]?.frequencies.length,
          sampleRate: sampleRates.value[slot],
        });
      } catch (error) {
        logger.error('analysisStore', `FFT computation failed for ${slot}`, { error: String(error) });
        throw error;
      }
      return;
    }

    // Compute both files
    if (audioBuffers.value.A.length === 0 || audioBuffers.value.B.length === 0) {
      throw new Error('Both audio files must be loaded before computing spectra');
    }

    const signalA = audioBuffers.value.A.slice(
      selections.value.A.startSample,
      selections.value.A.endSample,
    );
    const signalB = audioBuffers.value.B.slice(
      selections.value.B.startSample,
      selections.value.B.endSample,
    );

    const minLength = 128;
    if (signalA.length < minLength) {
      throw new Error(`Signal A too short (${signalA.length} samples, min ${minLength})`);
    }
    if (signalB.length < minLength) {
      throw new Error(`Signal B too short (${signalB.length} samples, min ${minLength})`);
    }

    try {
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
    } catch (error) {
      logger.error('analysisStore', 'FFT computation failed', { error: String(error) });
      throw error;
    }
  }

  async function computeIR(config: IRDerivationConfig): Promise<void> {
    logger.info('analysisStore', 'Computing IR', { method: config.method });

    if (!spectra.value.A || !spectra.value.B) {
      throw new Error('Spectra must be computed before deriving IR');
    }

    ir.value = deriveIR(spectra.value.A, spectra.value.B, config, sampleRates.value.A);
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

  function clearFile(slot: 'A' | 'B'): void {
    audioBuffers.value[slot] = new Float32Array();
    audioHeaders.value[slot] = null;
    sampleRates.value[slot] = 44100;
    selections.value[slot] = { startSample: 0, endSample: 0, duration: 0 };
    spectra.value[slot] = null;

    logger.info('analysisStore', `File cleared: ${slot}`);
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
    isAutoComputing,
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
    clearFile,
  };
});
