<template>
  <div class="debug-panel-wrapper">
    <!-- Debug Panel Drawer -->
    <div class="debug-drawer">
      <div class="debug-header">
        <h3 class="debug-title">Debug Logs</h3>
        <div class="debug-actions">
          <button @click="clearLogs" class="btn-icon" title="Clear logs">✕</button>
        </div>
      </div>

      <!-- Controls -->
      <div class="debug-controls">
        <div class="control-group">
          <input
            type="text"
            v-model="searchQuery"
            placeholder="Search logs..."
            class="search-input"
          />
        </div>

        <div class="filter-group">
          <button
            v-for="level in levels"
            :key="level"
            :class="['filter-btn', { active: activeLevels.includes(level) }]"
            @click="toggleLevel(level)"
          >
            {{ level }}
          </button>
        </div>
      </div>

      <!-- Log Feed -->
      <div class="log-feed" ref="logContainer">
        <div v-if="filteredLogs.length === 0" class="log-empty">
          No logs
        </div>

        <div
          v-for="(log, idx) in filteredLogs"
          :key="idx"
          :class="['log-entry', `log-${log.level}`]"
        >
          <div class="log-header">
            <span class="log-time">{{ formatTime(log.timestamp) }}</span>
            <span class="log-source">{{ log.source }}</span>
            <span class="log-level">{{ log.level.toUpperCase() }}</span>
          </div>
          <div class="log-message">{{ log.message }}</div>
          <div v-if="log.data" class="log-data">{{ JSON.stringify(log.data) }}</div>
        </div>
      </div>

      <!-- Footer -->
      <div class="debug-footer">
        <span class="log-count">{{ filteredLogs.length }} / {{ allLogs.length }}</span>
        <button @click="exportLogs" class="btn-icon" title="Export logs as JSON">
          ⬇
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { logger } from '../services/logging';
import type { LogEntry, LogLevel } from '../services/logging';

const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const searchQuery = ref('');
const activeLevels = ref<LogLevel[]>(['debug', 'info', 'warn', 'error']);
const allLogs = ref<LogEntry[]>([]);
const logContainer = ref<HTMLElement>();

const filteredLogs = computed(() => {
  return allLogs.value.filter((log) => {
    const matchLevel = activeLevels.value.includes(log.level);
    const matchSearch =
      searchQuery.value === '' ||
      log.message.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      log.source.toLowerCase().includes(searchQuery.value.toLowerCase());
    return matchLevel && matchSearch;
  });
});

onMounted(() => {
  updateLogs();
  setInterval(updateLogs, 500);
});

watch(filteredLogs, () => {
  // Auto-scroll to bottom
  if (logContainer.value) {
    setTimeout(() => {
      if (logContainer.value) {
        logContainer.value.scrollTop = logContainer.value.scrollHeight;
      }
    }, 0);
  }
});

function updateLogs(): void {
  allLogs.value = logger.getHistory();
}

function toggleLevel(level: LogLevel): void {
  const idx = activeLevels.value.indexOf(level);
  if (idx > -1) {
    activeLevels.value.splice(idx, 1);
  } else {
    activeLevels.value.push(level);
  }
}

function clearLogs(): void {
  logger.clear();
  allLogs.value = [];
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function exportLogs(): void {
  const json = logger.exportLog();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `debug-logs-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
</script>

<style scoped>
.debug-panel-wrapper {
  position: fixed;
  right: 0;
  bottom: 0;
  width: 400px;
  height: 60vh;
  z-index: 999;
  background-color: var(--color-bg);
  border-left: 1px solid var(--color-border);
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  animation: slideInRight 200ms ease-out;
}

@keyframes slideInRight {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

.debug-drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.debug-header {
  padding: 12px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.debug-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  font-family: var(--font-display);
}

.debug-actions {
  display: flex;
  gap: 8px;
}

.btn-icon {
  background: none;
  border: 1px solid var(--color-border);
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text-secondary);
  transition: all 150ms;
}

.btn-icon:hover {
  background-color: var(--color-border);
  color: var(--color-text-primary);
}

.debug-controls {
  padding: 12px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.control-group {
  display: flex;
}

.search-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-bg);
  color: var(--color-text-primary);
  font-size: 11px;
  font-family: var(--font-body);
}

.search-input:focus {
  border-color: var(--color-accent);
  outline: none;
}

.filter-group {
  display: flex;
  gap: 4px;
}

.filter-btn {
  flex: 1;
  padding: 4px 6px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background-color: transparent;
  color: var(--color-text-secondary);
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.filter-btn:hover {
  border-color: var(--color-accent);
}

.filter-btn.active {
  background-color: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
}

.log-feed {
  flex: 1;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 11px;
}

.log-empty {
  padding: 20px;
  text-align: center;
  color: var(--color-text-secondary);
}

.log-entry {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.log-entry.log-debug {
  color: #666666;
}

.log-entry.log-info {
  color: var(--color-text-primary);
}

.log-entry.log-warn {
  background-color: rgba(255, 149, 0, 0.05);
  color: var(--color-spectrum-b);
}

.log-entry.log-error {
  background-color: rgba(255, 59, 48, 0.05);
  color: #FF3B30;
}

.log-header {
  display: flex;
  gap: 8px;
  align-items: center;
}

.log-time {
  color: var(--color-text-secondary);
  font-weight: 600;
}

.log-source {
  color: var(--color-accent);
  font-weight: 500;
}

.log-level {
  font-size: 9px;
  font-weight: 600;
  opacity: 0.7;
}

.log-message {
  line-height: 1.4;
}

.log-data {
  color: var(--color-text-secondary);
  opacity: 0.8;
  word-break: break-all;
  max-height: 2em;
  overflow: hidden;
}

.debug-footer {
  padding: 8px 12px;
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.log-count {
  font-weight: 500;
}
</style>
