<template>
  <div id="app" class="app">
    <!-- Header -->
    <header class="app-header panel-side-bg">
      <div class="app-logo-section">
        <img src="/logo.svg" alt="Spectrum Matcher" class="app-logo" />
        <span class="app-title">Tone Matcher Software <span class="app-title-by">by Marco Pragliola</span></span>
      </div>
      <div class="app-header-actions">
        <button
          @click="cycleTheme"
          class="btn-icon"
          :title="`Switch to ${nextThemeMeta.title}`"
          :aria-label="`Switch to ${nextThemeMeta.title}`"
        >
          <Icon :name="THEME_META[currentTheme].icon" size="22" />
        </button>
        <button @click="showHelp = true" class="btn-icon" title="Help" aria-label="Help">
          <Icon name="help-circle" size="22" />
        </button>
      </div>
    </header>

    <!-- Main content -->
    <main class="app-main">
      <div class="main-left" :class="isSpectrumExpanded ? 'spectrum-expanded' : 'spectrum-minimized'">
        <!-- Top: the two waves, spanning sidebar + spectrum width -->
        <div class="panel panel-waves panel-side-bg">
          <FileUpload />
        </div>

        <div class="main-lower">
          <!-- Left panel: Controls & Recording -->
          <aside class="panel panel-input panel-side-bg">
            <DevicePicker />
          </aside>

          <!-- Center: Spectrum visualization -->
          <section class="panel panel-spectrum panel-side-bg">
            <SpectrumViewer
              :is-spectrum-expanded="isSpectrumExpanded"
              @toggle-expand="toggleSpectrumExpand"
            />
          </section>
        </div>
      </div>

      <!-- Right column: IR and Playback as separate panels -->
      <div class="main-right">
        <aside class="panel panel-ir panel-side-bg">
          <ImpulseResponseDisplay @ir-derived="onIRDerived" />
        </aside>
        <aside class="panel panel-playback panel-side-bg">
          <PlaybackPanel />
        </aside>
      </div>
    </main>

    <!-- Help Modal -->
    <Transition name="modal">
      <HelpModal v-if="showHelp" @close="showHelp = false" />
    </Transition>

    <!-- Status/Toast area -->
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div v-for="t in toasts" :key="t.id" class="toast animate-in-right">{{ t.message }}</div>
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import FileUpload from './components/FileUpload.vue';
import DevicePicker from './components/DevicePicker.vue';
import SpectrumViewer from './components/SpectrumViewer.vue';
import ImpulseResponseDisplay from './components/ImpulseResponseDisplay.vue';
import PlaybackPanel from './components/PlaybackPanel.vue';
import HelpModal from './components/HelpModal.vue';
import Icon from './components/Icon.vue';
import { logger } from './services/logging';
import { useAnalysisStore } from './stores/analysisStore';

type Theme = 'light' | 'dark' | 'sepia' | 'earth' | 'retro';

const THEME_ORDER: Theme[] = ['light', 'dark', 'sepia', 'earth', 'retro'];

function isValidTheme(value: string | null): value is Theme {
  return value !== null && (THEME_ORDER as string[]).includes(value);
}

const store = useAnalysisStore();
const showHelp = ref(false);
const currentTheme = ref<Theme>('dark');
const isSpectrumExpanded = ref(false);

const THEME_META: Record<Theme, { icon: string; title: string }> = {
  light: { icon: 'sun', title: 'Light mode' },
  dark: { icon: 'moon', title: 'Dark mode' },
  sepia: { icon: 'coffee', title: 'Sepia mode' },
  earth: { icon: 'droplet', title: 'Earth mode' },
  retro: { icon: 'terminal', title: 'Retro mode' },
};

const toasts = ref<{ id: number; message: string }[]>([]);

watch(
  () => store.lastError,
  (err) => {
    if (!err) return;
    toasts.value.push({ id: err.id, message: err.message });
    window.setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== err.id);
    }, 5000);
  },
);

const nextThemeMeta = computed(() => {
  const currentIndex = THEME_ORDER.indexOf(currentTheme.value);
  const nextTheme = THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length];
  return THEME_META[nextTheme];
});

function loadSpectrumExpandState(): void {
  const saved = localStorage.getItem('spectrum-expanded');
  if (saved !== null) {
    isSpectrumExpanded.value = saved === 'true';
  }
}

function saveSpectrumExpandState(): void {
  localStorage.setItem('spectrum-expanded', String(isSpectrumExpanded.value));
}

function toggleSpectrumExpand(): void {
  isSpectrumExpanded.value = !isSpectrumExpanded.value;
  saveSpectrumExpandState();
}

onMounted(() => {
  logger.info('App', 'Application mounted');
  initTheme();
  loadSpectrumExpandState();
});

function initTheme(): void {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  currentTheme.value = isValidTheme(saved) ? saved : (prefersDark ? 'dark' : 'light');
  applyTheme(currentTheme.value);
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

function cycleTheme(): void {
  const currentIndex = THEME_ORDER.indexOf(currentTheme.value);
  currentTheme.value = THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length];
  applyTheme(currentTheme.value);
}

function onIRDerived(e: any): void {
  logger.info('App', 'IR derived event received', { length: e.length });
}


</script>

<style lang="scss">
@use './styles/global.scss' as *;
@use './styles/components.scss' as *;
</style>

<style scoped lang="scss">
@use './styles/variables' as *;
@use './styles/mixins' as *;

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--color-bg);
  color: var(--color-text-primary);
  font-family: var(--font-body);
  font-size: var(--font-size-base);
}

.app-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  /* background set by .panel-side-bg */
}

.app-logo-section {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-logo {
  height: 48px;
  width: auto;
  @include themed(filter, none, invert(1), $earth: invert(1), $retro: invert(1) sepia(1) saturate(6) hue-rotate(70deg) brightness(1.1));
}

.app-title {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
}

.app-title-by {
  font-size: var(--font-size-sm);
  font-weight: 300;
  opacity: 0.6;
}

.app-header-actions {
  display: flex;
  gap: 8px;
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
  border-radius: var(--radius-md);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.main-left {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.main-lower {
  display: flex;
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.panel-waves {
  flex-shrink: 0;
  padding: 12px;
  overflow-y: visible;
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

.main-right {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
}

.panel-ir {
  padding: 12px;
  flex-shrink: 0;
}

.panel-playback {
  padding: 12px;
  flex-shrink: 0;
}

.toast-container {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
}

.toast {
  max-width: 320px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  background-color: var(--color-modal-bg);
  border: 1px solid var(--color-error);
  color: var(--color-error);
  box-shadow: var(--shadow-md);
  font-size: var(--font-size-sm);
}

.toast-leave-active {
  transition: opacity $transition-fast;
}

.toast-leave-to {
  opacity: 0;
}

// Transition utilities for expand/collapse animations
.panel-waves,
.panel-input {
  transition: opacity 300ms ease-out, transform 300ms ease-out;
}

// Expand mode: hide waves and sidebar, grow spectrum
.spectrum-expanded {
  .panel-waves {
    opacity: 0;
    transform: translateY(-20px);
    pointer-events: none;
    height: 0;
    overflow: hidden;
    padding: 0;
    margin: 0;
  }

  .main-lower {
    transition: gap 300ms ease-out;
    gap: 0;
  }

  .panel-input {
    opacity: 0;
    transform: translateX(-20px);
    pointer-events: none;
    width: 0;
    overflow: hidden;
    padding: 0;
    margin: 0;
  }

  .panel-spectrum {
    flex: 1;
    transition: flex 300ms ease-out, min-width 300ms ease-out;
    min-width: 0;
  }
}

// Minimized mode (default): waves and sidebar visible
.spectrum-minimized {
  .panel-waves {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }

  .main-lower {
    transition: gap 300ms ease-out;
  }

  .panel-input {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
  }

  .panel-spectrum {
    transition: flex 300ms ease-out, min-width 300ms ease-out;
  }
}

// Respect prefers-reduced-motion
@media (prefers-reduced-motion: reduce) {
  .panel-waves,
  .panel-input,
  .panel-spectrum {
    transition: none !important;
  }
}
</style>
