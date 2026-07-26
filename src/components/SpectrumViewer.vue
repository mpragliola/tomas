<template>
  <div class="spectrum-viewer">
    <div class="spectrum-header">
      <h3 class="spectrum-title">Frequency Spectrum</h3>
      <div class="spectrum-controls">
        <label class="checkbox-label">
          <input type="checkbox" v-model="showA" />
          <span class="label-text">A</span>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" v-model="showB" />
          <span class="label-text">B</span>
        </label>
      </div>
    </div>

    <!-- Container stays mounted so the ref is always valid; states overlay it -->
    <div class="plot-area">
      <div ref="plotContainer" class="plot-container"></div>

      <div v-if="store.isAutoComputing" class="overlay loading-state">
        <div class="spinner"></div>
        <p>Computing spectra...</p>
      </div>

      <div v-else-if="!store.spectra.A && !store.spectra.B" class="overlay empty-state">
        <p>Compute spectra to display</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';

const store = useAnalysisStore();
const plotContainer = ref<HTMLElement>();
const showA = ref(true);
const showB = ref(true);
let plotInitialized = false;

onMounted(async () => {
  logger.info('SpectrumViewer', 'Mounted');
  // Initial plot if spectra exist
  if (store.spectra.A || store.spectra.B) {
    await updatePlot();
  }
});

watch(
  () => [store.spectra.A, store.spectra.B],
  async () => {
    await updatePlot();
  },
  { deep: true }
);

watch([showA, showB], async () => {
  await updatePlot();
});

async function updatePlot(): Promise<void> {
  // Let any pending render flush before touching the container
  await nextTick();

  if (!plotContainer.value) {
    plotInitialized = false;
    return;
  }

  try {
    const Plotly = (await import('plotly.js/dist/plotly')).default;

    const traces: any[] = [];
    const { A, B } = store.spectra;

    if (showA.value && A) {
      traces.push({
        x: Array.from(A.frequencies).slice(0, 500),
        y: Array.from(A.magnitudesDb).slice(0, 500),
        type: 'scatter',
        mode: 'lines',
        name: 'Spectrum A',
        line: {
          color: '#2563EB',
          width: 1,
        },
        hovertemplate: '<b>A</b><br>%{x:.1f}Hz<br>%{y:.1f}dB<extra></extra>',
      });
    }

    if (showB.value && B) {
      traces.push({
        x: Array.from(B.frequencies).slice(0, 500),
        y: Array.from(B.magnitudesDb).slice(0, 500),
        type: 'scatter',
        mode: 'lines',
        name: 'Spectrum B',
        line: {
          color: '#FF9500',
          width: 1,
        },
        hovertemplate: '<b>B</b><br>%{x:.1f}Hz<br>%{y:.1f}dB<extra></extra>',
      });
    }

    const layout = {
      title: '',
      xaxis: {
        title: 'Frequency (Hz)',
        type: 'log',
        zeroline: false,
        gridcolor: '#333333',
      },
      yaxis: {
        title: 'Magnitude (dB)',
        zeroline: false,
        gridcolor: '#333333',
      },
      plot_bgcolor: 'rgba(26, 26, 26, 0.5)',
      paper_bgcolor: '#1A1A1A',
      font: {
        family: 'sans-serif',
        size: 12,
        color: '#E5E5E5',
      },
      margin: { l: 40, r: 20, t: 30, b: 40 },
      hovermode: 'x unified',
      showlegend: true,
      legend: {
        x: 0.98,
        y: 0.98,
        bgcolor: 'rgba(0, 0, 0, 0.5)',
        bordercolor: '#333333',
        borderwidth: 1,
      },
    };

    const config = {
      responsive: true,
      displayModeBar: false,
    };

    if (traces.length === 0) {
      if (plotInitialized) {
        Plotly.purge(plotContainer.value);
        plotInitialized = false;
        logger.debug('SpectrumViewer', 'Plot cleared');
      }
    } else if (!plotInitialized) {
      Plotly.newPlot(plotContainer.value, traces, layout, config);
      plotInitialized = true;
      logger.info('SpectrumViewer', 'Plot initialized');
    } else {
      Plotly.react(plotContainer.value, traces, layout, config);
      logger.debug('SpectrumViewer', 'Plot updated');
    }
  } catch (error) {
    logger.error('SpectrumViewer', 'Plot error', { error: String(error) });
  }
}
</script>

<style scoped>
.spectrum-viewer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

.spectrum-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.spectrum-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  font-family: var(--font-display);
}

.spectrum-controls {
  display: flex;
  gap: 12px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.checkbox-label input {
  cursor: pointer;
}

.label-text {
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
  background-color: var(--color-border);
}

.checkbox-label input:checked + .label-text {
  background-color: var(--color-accent);
  color: white;
}

.plot-area {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.overlay {
  position: absolute;
  inset: 0;
  background-color: var(--color-bg);
  border-radius: var(--radius-md);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  font-size: 14px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  gap: 12px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(37, 99, 235, 0.2);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 600ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.plot-container {
  flex: 1;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-bg);
  overflow: hidden;
}

:deep(.plotly) {
  width: 100%;
  height: 100%;
}
</style>
