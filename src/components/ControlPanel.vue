<template>
  <div class="control-panel"></div>
</template>

<script setup lang="ts">
</script>

<style lang="scss" scoped>
@use '../styles/variables' as *;
@use '../styles/mixins' as *;

$gap-xs: 4px;
$gap-sm: 6px;
$gap-md: 8px;

@mixin btn-disabled {
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.control-panel {
  display: flex;
  flex-direction: column;
  gap: $gap-md;
  overflow: visible;
  flex-shrink: 0;
  min-height: auto;
}

.section {
  display: flex;
  flex-direction: column;
  gap: $gap-md;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title {
  @include caps-label;
}

.control-row {
  display: flex;
  flex-direction: column;
  gap: $gap-xs;
}

.input-label {
  @include caps-label(var(--font-size-micro));
}

.input-select,
.input-number {
  padding: $gap-sm $gap-md;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-bg);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-family: var(--font-body);
  transition: border-color $transition-fast;

  &:hover { border-color: var(--color-text-secondary); }
  &:focus {
    border-color: var(--color-accent);
    outline: none;
  }
}

.btn {
  padding: $gap-md;
  border: none;
  border-radius: var(--radius-lg);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all $transition-fast;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $gap-sm;

  @include btn-disabled;

  &-primary {
    background-color: var(--color-accent);
    color: var(--color-accent-text);

    &:hover:not(:disabled) { filter: brightness(1.1); }
    &:active:not(:disabled) { filter: brightness(0.95); }
  }

  &-secondary {
    background-color: var(--color-border);
    color: var(--color-text-primary);

    &:hover:not(:disabled) {
      filter: brightness(0.9);
    }
  }
}

.divider {
  height: 1px;
  background-color: var(--color-border);
}

.compute-buttons {
  display: flex;
  gap: $gap-md;
}

.btn-icon-text {
  flex: 1;
  padding: $gap-md;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-accent);
  color: var(--color-accent-text);
  font-size: var(--font-size-lg);
  cursor: pointer;
  transition: all $transition-fast;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover:not(:disabled) { filter: brightness(1.1); }
  @include btn-disabled;
}

.settings-toggle {
  width: 100%;
  padding: $gap-sm;
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-label);
  font-weight: 500;
  cursor: pointer;
  transition: all $transition-fast;
  text-align: left;

  &:hover {
    background-color: color-mix(in srgb, var(--color-accent) 5%, transparent);
    border-color: var(--color-accent);
  }
}

.status-message {
  padding: $gap-sm $gap-md;
  border-radius: var(--radius-sm);
  background-color: color-mix(in srgb, var(--color-accent) 10%, transparent);
  border: 1px solid var(--color-accent);
  color: var(--color-accent);
  font-size: var(--font-size-micro);
  font-weight: 500;
  text-align: center;
  margin-top: $gap-xs;
}

.fade-rise-enter-active {
  animation: slideIn 200ms ease-out;
}

.fade-rise-leave-active {
  transition: opacity $transition-fast;
}

.fade-rise-leave-to {
  opacity: 0;
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
</style>
