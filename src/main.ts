import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { logger } from './services/logging';
import { useAnalysisStore } from './stores/analysisStore';

const app = createApp(App);

app.use(createPinia());

app.mount('#app');

// Dev-only console handles. The logger keeps its own ring buffer, so `__logger.getHistory()`
// shows what happened even when the devtools console is filtered or was opened late.
if (import.meta.env.DEV) {
  const globals = window as any;
  globals.__logger = logger;
  globals.__store = useAnalysisStore();
  console.log('[dev] __logger and __store available on window');
}
