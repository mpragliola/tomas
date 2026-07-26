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

    <div v-if="!store.spectra.A && !store.spectra.B" class="empty-state">
      <p>Compute spectra to display</p>
    </div>

    <div v-else ref="plotContainer" class="plot-container"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import * as Plotly from 'plotly.js';
import { useAnalysisStore } from '../stores/analysisStore';
import { logger } from '../services/logging';

const store = useAnalysisStore();
const plotContainer = ref<HTMLElement>();
const showA = ref(true);
const showB = ref(true);
let plotInitialized = false;

onMounted(() => {
  logger.info('SpectrumViewer', 'Mounted');
  if (store.spectra.A || store.spectra.B) {
    updatePlot();
  }
});

watch(
  () => [store.spectra.A, store.spectra.B],
  () => {
    updatePlot();
  },
  { deep: true }
);

watch([showA, showB], () => {
  updatePlot();
});

function updatePlot(): void {
  if (!plotContainer.value) return;

  const traces: any[] = [];
  const { A, B } = store.spectra;

  if (showA.value && A) {
    traces.push({
      x: Array.from(A.frequencies),
      y: Array.from(A.magnitudesDb),
      type: 'scatter',
      mode: 'lines',
      name: 'Spectrum A (Target)',
      line: {
        color: 'var(--color-spectrum-a)',
        width: 1,
      },
      hovertemplate: '<b>A</b><br>%{x:.1f}Hz<br>%{y:.1f}dB<extra></extra>',
    });
  }

  if (showB.value && B) {
    traces.push({
      x: Array.from(B.frequencies),
      y: Array.from(B.magnitudesDb),
      type: 'scatter',
      mode: 'lines',
      name: 'Spectrum B (Ref)',
      line: {
        color: 'var(--color-spectrum-b)',
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
      gridcolor: 'var(--color-border)',
    },
    yaxis: {
      title: 'Magnitude (dB)',
      zeroline: false,
      gridcolor: 'var(--color-border)',
    },
    plot_bgcolor: 'rgba(26, 26, 26, 0.5)',
    paper_bgcolor: 'var(--color-bg)',
    font: {
      family: 'var(--font-body)',
      size: 12,
      color: 'var(--color-text-primary)',
    },
    margin: { l: 40, r: 20, t: 30, b: 40 },
    hovermode: 'x unified',
    showlegend: true,
    legend: {
      x: 0.98,
      y: 0.98,
      bgcolor: 'rgba(0, 0, 0, 0.5)',
      bordercolor: 'var(--color-border)',
      borderwidth: 1,
    },
  };

  const config = {
    responsive: true,
    displayModeBar: false,
  };

  if (!plotInitialized && plotContainer.value) {
    Plotly.newPlot(plotContainer.value, traces, layout, config);
    plotInitialized = true;
    logger.info('SpectrumViewer', 'Plot initialized');
  } else if (plotInitialized && plotContainer.value) {
    Plotly.react(plotContainer.value, traces, layout, config);
    logger.debug('SpectrumViewer', 'Plot updated');
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

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--color-text-secondary);
  font-size: 14px;
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
