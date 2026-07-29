<template>
  <Teleport to="body">
    <div ref="root" class="eq-popover" role="dialog" :style="popoverStyle">
      <div class="eq-popover-header">
        <span class="eq-popover-title">{{ frequencyLabel }}</span>
        <label class="eq-popover-enabled">
          <input
            type="checkbox"
            :checked="band.enabled"
            @change="emit('update', { enabled: ($event.target as HTMLInputElement).checked })"
          />
          On
        </label>
      </div>

      <div class="eq-popover-row">
        <label class="eq-popover-label">Type</label>
        <select
          :value="band.type"
          class="eq-input-select"
          @change="emit('update', { type: ($event.target as HTMLSelectElement).value as GraphicEqBandType })"
        >
          <option value="peaking">Band (peaking)</option>
          <option value="lowshelf">Low shelf</option>
          <option value="highshelf">High shelf</option>
          <option value="lowpass">Low pass</option>
          <option value="highpass">High pass</option>
          <option value="notch">Notch</option>
        </select>
      </div>

      <div class="eq-popover-row">
        <label class="eq-popover-label">Frequency (Hz)</label>
        <input
          type="number"
          :value="Math.round(band.frequency)"
          min="20" max="20000" step="1"
          class="eq-input-number"
          @change="emit('update', { frequency: clampNumber($event, 20, 20000) })"
        />
      </div>

      <div class="eq-popover-row">
        <label class="eq-popover-label">Gain (dB)</label>
        <input
          type="number"
          :value="band.gain.toFixed(1)"
          :min="GRAPHIC_EQ_GAIN_RANGE_DB[0]" :max="GRAPHIC_EQ_GAIN_RANGE_DB[1]" step="0.1"
          class="eq-input-number"
          :disabled="gainDisabled"
          :title="gainDisabled ? 'This filter type ignores gain' : ''"
          @change="emit('update', { gain: clampNumber($event, GRAPHIC_EQ_GAIN_RANGE_DB[0], GRAPHIC_EQ_GAIN_RANGE_DB[1]) })"
        />
      </div>

      <div class="eq-popover-row">
        <label class="eq-popover-label">Q</label>
        <input
          type="number"
          :value="band.q.toFixed(2)"
          :min="GRAPHIC_EQ_Q_RANGE[0]" :max="GRAPHIC_EQ_Q_RANGE[1]" step="0.01"
          class="eq-input-number"
          @change="emit('update', { q: clampNumber($event, GRAPHIC_EQ_Q_RANGE[0], GRAPHIC_EQ_Q_RANGE[1]) })"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { GRAPHIC_EQ_GAIN_RANGE_DB, GRAPHIC_EQ_Q_RANGE } from '../types/graphicEq';
import type { GraphicEqBand, GraphicEqBandType } from '../types/graphicEq';

const props = defineProps<{
  band: GraphicEqBand;
  anchor: DOMRect;
}>();

const emit = defineEmits<{
  (e: 'update', partial: Partial<GraphicEqBand>): void;
  (e: 'close'): void;
}>();

const root = ref<HTMLElement>();

const gainDisabled = computed(() =>
  props.band.type === 'lowpass' || props.band.type === 'highpass' || props.band.type === 'notch',
);

const frequencyLabel = computed(() => {
  const f = props.band.frequency;
  return f >= 1000 ? `${(f / 1000).toFixed(f % 1000 === 0 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`;
});

function clampNumber(event: Event, min: number, max: number): number {
  const raw = Number((event.target as HTMLInputElement).value);
  return Math.min(max, Math.max(min, Number.isFinite(raw) ? raw : min));
}

const POPOVER_WIDTH = 200;

const popoverStyle = computed(() => {
  const r = props.anchor;
  const rawLeft = r.left + r.width / 2 - POPOVER_WIDTH / 2;
  const left = Math.min(Math.max(8, rawLeft), window.innerWidth - POPOVER_WIDTH - 8);
  // Prefer opening below the handle; flip above if there isn't room.
  const estimatedHeight = 220;
  const top =
    r.bottom + 8 + estimatedHeight > window.innerHeight
      ? Math.max(8, r.top - estimatedHeight - 8)
      : r.bottom + 8;
  return { left: `${left}px`, top: `${top}px` };
});

/**
 * Capture phase, not bubble: a handle's own pointerdown calls `stopPropagation` (so it
 * doesn't fall through to Plotly's drag/zoom underneath), which would otherwise stop this
 * listener too if it ran during the bubble phase. Capture runs before that, on the way
 * down, so it always sees the click regardless of what happens at the target.
 */
function onOutsidePointerDown(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) emit('close');
}

onMounted(() => document.addEventListener('pointerdown', onOutsidePointerDown, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutsidePointerDown, true));
</script>

<style lang="scss" scoped>
@use '../styles/variables' as *;

.eq-popover {
  position: fixed;
  width: 200px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background-color: var(--color-bg-elevated, var(--color-bg));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  z-index: 9999;
  font-size: var(--font-size-sm);
}

.eq-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-border);
}

.eq-popover-title {
  font-weight: 600;
  color: var(--color-text-primary);
}

.eq-popover-enabled {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-micro);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.eq-popover-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.eq-popover-label {
  font-size: var(--font-size-micro);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.eq-input-select,
.eq-input-number {
  width: 100px;
  padding: 4px 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background-color: var(--color-bg);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-family: inherit;

  &:hover { border-color: var(--color-text-secondary); }
  &:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style>
