<template>
  <div class="section">
    <div class="section-header">
      <label class="section-title">{{ title }}</label>
      <TooltipIcon :text="tooltipText" />
    </div>

    <!-- Head shrinks and ellipsizes, tail never does — so the extension stays readable -->
    <div v-if="sourceName" class="source-name" :title="sourceName">
      <span class="source-name-head">{{ nameHead }}</span><span class="source-name-tail">{{ nameTail }}</span>
    </div>

    <div class="upload-area" :class="{ loaded: hasAudio }">
      <WaveformEditor
        target="A"
        active
        @clear="clearSlot"
        @status="setStatus"
      />
    </div>

    <div v-if="message" class="status-message">
      {{ message }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import TooltipIcon from '../TooltipIcon.vue';
import WaveformEditor from './WaveformEditor.vue';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useStatusMessage } from '../../composables/useStatusMessage';

defineProps<{
  title: string;
  tooltipText: string;
}>();

const store = useAnalysisStore();
const { message, show, clear: clearStatus } = useStatusMessage();

// An empty message means "whatever was showing no longer applies", not "show nothing
// for 3 seconds" — the latter would leave a stale banner up on its own timer
function setStatus(text: string, durationMs?: number): void {
  if (text) show(text, durationMs);
  else clearStatus();
}

const hasAudio = computed(() => store.audioBufferA.length > 0);

const sourceName = computed(() => (hasAudio.value ? store.sourceNameA : ''));

/** Trailing run kept out of the ellipsis — long enough for the extension and a little of the stem. */
const TAIL_CHARS = 8;
const nameHead = computed(() =>
  sourceName.value.length > TAIL_CHARS + 4 ? sourceName.value.slice(0, -TAIL_CHARS) : sourceName.value,
);
const nameTail = computed(() =>
  sourceName.value.length > TAIL_CHARS + 4 ? sourceName.value.slice(-TAIL_CHARS) : '',
);

function clearSlot(): void {
  store.clearFile();
}
</script>

<style lang="scss" scoped>
@use '../../styles/variables' as *;
@use '../../styles/mixins' as *;

.section {
  margin-bottom: 12px;

  &-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  &-title {
    @include caps-label;
  }
}

/* Middle elision: only the head shrinks so the file extension stays readable */
.source-name {
  display: flex;
  min-width: 0;
  align-items: center;
  min-height: 28px;
  margin: 0 0 8px;
  font-size: var(--font-size-micro);
  color: var(--color-accent);
  white-space: nowrap;
}

.source-name-head {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.source-name-tail { flex: 0 0 auto; }

.upload-area {
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-md);
  padding: 12px;
  text-align: center;
  transition: all $transition-fast;
  min-height: 80px;
  display: flex;
  flex-direction: column;

  &.loaded {
    border-color: var(--color-accent);
    background-color: color-mix(in srgb, var(--color-accent) 3%, transparent);
    padding: 8px;
  }
}

.status-message {
  margin-top: 8px;
  padding: 8px;
  border-radius: var(--radius-sm);
  background-color: color-mix(in srgb, var(--color-error) 10%, transparent);
  border: 1px solid var(--color-error);
  color: var(--color-error);
  font-size: var(--font-size-label);
  font-weight: 500;
  text-align: center;
  animation: slideIn 200ms ease-out;
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
</style>
