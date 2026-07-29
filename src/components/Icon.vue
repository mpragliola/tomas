<template>
  <svg
    v-if="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="feather-icon"
    :style="retroThemeStyle"
    aria-hidden="true"
    focusable="false"
  >
    <g v-html="icon.contents" />
  </svg>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import * as featherIconsLib from 'feather-icons';

interface Props {
  name: string;
  /**
   * Callers overwhelmingly write `size="16"`, which is a string literal attribute, not a
   * bound number. Accepting both keeps that spelling valid — the value only ever reaches
   * the SVG width/height attributes, which take either.
   */
  size?: number | string;
}

const props = withDefaults(defineProps<Props>(), {
  size: 24,
});

const currentTheme = ref(document.documentElement.getAttribute('data-theme') || '');

onMounted(() => {
  const observer = new MutationObserver(() => {
    currentTheme.value = document.documentElement.getAttribute('data-theme') || '';
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  onUnmounted(() => observer.disconnect());
});

const icon = computed(() => {
  const iconName = props.name.replace(/([A-Z])/g, '-$1').toLowerCase() as keyof typeof featherIconsLib.icons;
  return (featherIconsLib.icons as any)[iconName] || null;
});

const retroThemeStyle = computed(() => {
  if (currentTheme.value === 'retro') {
    return {
      stroke: '#33FF33',
      color: '#33FF33',
      filter: 'drop-shadow(0 0 2px rgba(51, 255, 51, 0.6))',
    };
  }
  return {};
});
</script>

<style lang="scss" scoped>
.feather-icon {
  display: inline-block;
  vertical-align: middle;
  color: currentColor;
}
</style>
