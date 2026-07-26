<template>
  <div id="app" style="padding: 20px; background: #1a1a1a; color: #e5e5e5;">
    <h1>🎵 Spectrum Matcher</h1>
    <p>App loaded successfully</p>
    <p>Store loaded: {{ store !== undefined }}</p>
  </div>
</template>

<script setup lang="ts">
import { useAnalysisStore } from './stores/analysisStore';
const store = useAnalysisStore();
</script>
