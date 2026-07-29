<template>
  <div ref="anchor" class="tooltip-icon-wrapper" @mouseenter="show" @mouseleave="hide">
    <Icon name="info" size="16" class="info-icon" />
    <Teleport to="body">
      <div
        v-if="visible"
        class="tooltip"
        role="tooltip"
        :style="tooltipStyle"
      >
        {{ text }}
        <span class="tooltip-arrow" :style="arrowStyle" />
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import Icon from './Icon.vue';

defineProps<{ text: string }>();

const anchor = ref<HTMLElement>();
const visible = ref(false);
const anchorRect = ref<DOMRect>();

function show() {
  anchorRect.value = anchor.value?.getBoundingClientRect();
  visible.value = true;
}

function hide() {
  visible.value = false;
}

const TOOLTIP_WIDTH = 220;

const tooltipStyle = computed(() => {
  const r = anchorRect.value;
  if (!r) return {};
  const anchorCenterX = r.left + r.width / 2;
  const rawLeft = anchorCenterX - TOOLTIP_WIDTH / 2;
  const left = Math.min(Math.max(8, rawLeft), window.innerWidth - TOOLTIP_WIDTH - 8);
  const top = r.bottom + 8;
  return {
    left: `${left}px`,
    top: `${top}px`,
  };
});

const arrowStyle = computed(() => {
  const r = anchorRect.value;
  if (!r) return {};
  const anchorCenterX = r.left + r.width / 2;
  const rawLeft = anchorCenterX - TOOLTIP_WIDTH / 2;
  const left = Math.min(Math.max(8, rawLeft), window.innerWidth - TOOLTIP_WIDTH - 8);
  const arrowLeft = anchorCenterX - left;
  return { left: `${arrowLeft}px` };
});
</script>

<style lang="scss" scoped>
@use '../styles/variables' as *;

.tooltip-icon-wrapper {
  display: flex;
  align-items: center;
  cursor: default;

  .info-icon {
    color: var(--color-text-secondary);
    opacity: 0.5;
    transition: opacity $transition-fast, color $transition-fast;
  }

  &:hover .info-icon {
    opacity: 1;
    color: var(--color-accent);
  }
}
</style>

<style lang="scss">
@use '../styles/variables' as *;

.tooltip {
  position: fixed;
  width: 220px;
  background-color: var(--color-text-primary);
  color: var(--color-bg);
  font-size: var(--font-size-micro);
  font-family: var(--font-body);
  line-height: 1.4;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  z-index: 9999;
  box-shadow: var(--shadow-md);
  pointer-events: none;
}

.tooltip-arrow {
  position: absolute;
  bottom: 100%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-bottom-color: var(--color-text-primary);
}
</style>
