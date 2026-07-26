<template>
  <div id="app" class="app">
    <!-- Header -->
    <header class="app-header">
      <h1 class="app-title">Spectrum Matcher</h1>
      <div class="app-header-actions">
        <button v-if="debugAvailable" @click="toggleDebug" class="btn-icon" title="Debug (Ctrl+Shift+D)">
          ⚙
        </button>
      </div>
    </header>

    <!-- Main content -->
    <main class="app-main">
      <!-- Left panel: Input & Controls -->
      <aside class="panel panel-input panel-side-bg">
        <FileUpload @file-loaded="onFileLoaded" />
        <ControlPanel @params-changed="onParamsChanged" />
        <RecordingPanel @recorded="onRecorded" />
        <WaveformViewer />
      </aside>

      <!-- Center: Spectrum visualization -->
      <section class="panel panel-spectrum">
        <SpectrumViewer />
      </section>

      <!-- Right panel: IR & Playback -->
      <aside class="panel panel-output panel-side-bg">
        <ImpulseResponseDisplay @ir-derived="onIRDerived" />
        <PlaybackPanel />
      </aside>
    </main>

    <!-- Debug panel (hidden by default) -->
    <DebugPanel v-if="showDebug" />

    <!-- Status/Toast area -->
    <div class="toast-container" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import FileUpload from './components/FileUpload.vue';
import RecordingPanel from './components/RecordingPanel.vue';
import WaveformViewer from './components/WaveformViewer.vue';
import SpectrumViewer from './components/SpectrumViewer.vue';
import ImpulseResponseDisplay from './components/ImpulseResponseDisplay.vue';
import PlaybackPanel from './components/PlaybackPanel.vue';
import ControlPanel from './components/ControlPanel.vue';
import DebugPanel from './components/DebugPanel.vue';
import { logger } from './services/logging';
import { useAnalysisStore } from './stores/analysisStore';

const store = useAnalysisStore();
const showDebug = ref(false);
const debugAvailable = ref(true);

onMounted(() => {
  logger.info('App', 'Application mounted');
  // Listen for Ctrl+Shift+D to toggle debug
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      toggleDebug();
    }
  });
});

function toggleDebug(): void {
  showDebug.value = !showDebug.value;
  logger.info('App', `Debug panel ${showDebug.value ? 'opened' : 'closed'}`);
}

function onFileLoaded(e: any): void {
  logger.info('App', 'File loaded event received', { slot: e.slot });
}

function onRecorded(e: any): void {
  logger.info('App', 'Recording completed', { samples: e.samples });
}

function onIRDerived(e: any): void {
  logger.info('App', 'IR derived event received', { length: e.length });
}

function onParamsChanged(e: any): void {
  logger.debug('App', 'Params changed', e);
}
</script>

<style>
@import './styles/global.css';
@import './styles/components.css';
</style>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--color-bg);
  color: var(--color-text-primary);
  font-family: var(--font-body);
  font-size: 14px;
}

.app-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.app-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  font-family: var(--font-display);
}

.app-header-actions {
  display: flex;
  gap: 8px;
}

.btn-icon {
  background: none;
  border: 1px solid var(--color-border);
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  color: var(--color-text-secondary);
  transition: all 150ms;
}

.btn-icon:hover {
  background-color: var(--color-border);
  color: var(--color-text-primary);
}

.app-main {
  display: flex;
  gap: 12px;
  flex: 1;
  overflow: hidden;
  padding: 12px;
}

.panel {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background-color: var(--color-bg);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.panel-input {
  width: 280px;
  flex-shrink: 0;
  padding: 12px;
  gap: 12px;
}

.panel-spectrum {
  flex: 1;
  min-width: 300px;
  padding: 12px;
}

.panel-output {
  width: 300px;
  flex-shrink: 0;
  padding: 12px;
  gap: 12px;
}

.toast-container {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 1000;
}
</style>
