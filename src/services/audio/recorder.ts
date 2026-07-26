import type { RecorderConfig, RecorderState } from '../../types/audio';
import { logger } from '../logging';
import { rms } from '../../utils/mathUtils';

export class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private isRecording = false;
  private isPaused = false;
  private recordedChunks: Float32Array[] = [];
  private currentLevel = 0;
  private recordedDuration = 0;
  private startTime = 0;
  private autoTriggered = false;
  private silenceStart = 0;
  private config: RecorderConfig | null = null;

  async start(config: RecorderConfig): Promise<void> {
    logger.info('AudioRecorder', 'Starting recording', { maxDuration: config.maxDuration });

    this.config = config;
    this.recordedChunks = [];
    this.recordedDuration = 0;
    this.autoTriggered = false;
    this.silenceStart = Date.now();

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: config.sampleRate,
      });

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;

      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.source.connect(this.analyser);
      this.analyser.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);

      this.scriptProcessor.onaudioprocess = (event) => this.processAudio(event);

      this.isRecording = true;
      this.startTime = Date.now();

      logger.info('AudioRecorder', 'Recording started');
    } catch (error) {
      logger.error('AudioRecorder', 'Failed to start recording', { error: String(error) });
      throw error;
    }
  }

  async stop(): Promise<Float32Array> {
    if (!this.isRecording) {
      throw new Error('Recording not started');
    }

    logger.info('AudioRecorder', 'Stopping recording', { chunks: this.recordedChunks.length });

    this.isRecording = false;

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
    }
    if (this.analyser) {
      this.analyser.disconnect();
    }
    if (this.source) {
      this.source.disconnect();
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }
    if (this.audioContext) {
      await this.audioContext.close();
    }

    // Concatenate all chunks
    const totalLength = this.recordedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const audioData = new Float32Array(totalLength);
    let offset = 0;

    for (const chunk of this.recordedChunks) {
      audioData.set(chunk, offset);
      offset += chunk.length;
    }

    logger.info('AudioRecorder', 'Recording stopped', { totalSamples: totalLength });

    return audioData;
  }

  pause(): void {
    this.isPaused = true;
    logger.info('AudioRecorder', 'Recording paused');
  }

  resume(): void {
    this.isPaused = false;
    logger.info('AudioRecorder', 'Recording resumed');
  }

  getRecordedDuration(): number {
    return Math.min(this.recordedDuration, this.config?.maxDuration || 20000);
  }

  getCurrentLevel(): number {
    return this.currentLevel;
  }

  getState(): RecorderState {
    return {
      isRecording: this.isRecording,
      isPaused: this.isPaused,
      recordedDuration: this.getRecordedDuration(),
      level: this.currentLevel,
    };
  }

  private processAudio(event: AudioProcessingEvent): void {
    if (!this.config) return;

    const inputData = event.inputBuffer.getChannelData(0);
    const chunk = new Float32Array(inputData.length);
    chunk.set(inputData);

    // Calculate level
    this.currentLevel = rms(chunk);
    const currentLevelDb = 20 * Math.log10(Math.max(this.currentLevel, 1e-10));

    // Check auto-trigger threshold
    if (!this.autoTriggered && currentLevelDb > this.config.autoThreshold) {
      this.autoTriggered = true;
      logger.info('AudioRecorder', 'Auto-trigger activated', { levelDb: currentLevelDb });
    }

    // Record if started or auto-triggered
    if (!this.isPaused && (this.isRecording || this.autoTriggered)) {
      // Check max duration
      if (this.recordedDuration < this.config.maxDuration) {
        this.recordedChunks.push(chunk);
        this.recordedDuration += (chunk.length / this.config.sampleRate) * 1000;
      } else {
        logger.warn('AudioRecorder', 'Max recording duration reached');
        this.isRecording = false;
      }
    }

    // Check for silence end (for auto-stop)
    if (this.autoTriggered && currentLevelDb < this.config.autoThreshold - 10) {
      const silenceDuration = Date.now() - this.silenceStart;
      if (silenceDuration > 1000) {
        logger.info('AudioRecorder', 'Auto-stop triggered (silence)');
        this.isRecording = false;
      }
    } else {
      this.silenceStart = Date.now();
    }
  }
}
