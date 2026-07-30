<template>
  <div class="tab-bar">
    <div class="tabs" role="tablist">
      <div
        v-for="id in store.referenceOrder"
        :key="id"
        class="tab"
        :class="{ active: id === store.activeReferenceId }"
        role="tab"
        :aria-selected="id === store.activeReferenceId"
        :title="store.references[id]?.label"
        @click="store.setActiveReference(id)"
      >
        <span class="tab-label">{{ store.references[id]?.label }}</span>
        <button
          type="button"
          class="tab-icon-btn"
          :disabled="atMax"
          :title="atMax ? maxTooltip : 'Clone this reference (same audio, independent loop)'"
          @click.stop="emit('clone', id)"
        >
          <Icon name="copy" size="12" />
        </button>
        <button
          type="button"
          class="tab-icon-btn tab-close"
          title="Remove this reference"
          @click.stop="emit('remove', id)"
        >
          <Icon name="x" size="12" />
        </button>
      </div>
    </div>

    <button
      type="button"
      class="tab-add-btn"
      :disabled="atMax"
      :title="atMax ? maxTooltip : 'Add another reference'"
      @click="emit('add')"
    >
      <Icon name="plus" size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Icon from '../Icon.vue';
import { useAnalysisStore } from '../../stores/analysisStore';

const store = useAnalysisStore();

const emit = defineEmits<{
  add: [];
  clone: [id: string];
  remove: [id: string];
}>();

const atMax = computed(() => store.referenceOrder.length >= store.MAX_REFERENCES);
const maxTooltip = computed(
  () => `You can compare up to ${store.MAX_REFERENCES} references at once — remove one first`,
);
</script>

<style lang="scss" scoped>
@use '../../styles/variables' as *;

.tab-bar {
  display: flex;
  align-items: stretch;
  gap: 4px;
  margin-bottom: 6px;
}

.tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  min-width: 0;
  flex: 1;
}

.tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-bg);
  color: var(--color-text-secondary);
  font-size: var(--font-size-label);
  cursor: pointer;
  white-space: nowrap;
  transition: all $transition-fast;
  flex-shrink: 0;

  &:hover {
    border-color: var(--color-accent);
    color: var(--color-text-primary);
  }

  &.active {
    border-color: var(--color-accent);
    background-color: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-accent);
  }
}

.tab-label {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: 2px;
  border-radius: var(--radius-sm);
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  transition: all $transition-fast;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    opacity: 1;
    background-color: color-mix(in srgb, var(--color-accent) 15%, transparent);
  }

  &:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }
}

.tab-close:hover:not(:disabled) {
  color: var(--color-error);
  background-color: color-mix(in srgb, var(--color-error) 15%, transparent);
}

.tab-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  flex-shrink: 0;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-bg);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all $transition-fast;

  &:hover:not(:disabled) {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}
</style>
