<template>
  <div id="app" style="padding: 20px; background: #1a1a1a; color: #e5e5e5; font-family: sans-serif;">
    <h1>Debug: Import Test</h1>
    <p>Vue: ✓</p>
    <p>Logger: {{ loggerLoaded }}</p>
    <p>Store: {{ storeLoaded }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const loggerLoaded = ref(false);
const storeLoaded = ref(false);

try {
  import('./services/logging').then(() => {
    loggerLoaded.value = true;
  });
} catch (e) {
  console.error('Logger import failed:', e);
}

try {
  import('./stores/analysisStore').then(() => {
    storeLoaded.value = true;
  });
} catch (e) {
  console.error('Store import failed:', e);
}
</script>
