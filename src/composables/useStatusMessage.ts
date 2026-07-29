import { onUnmounted, ref } from 'vue';

/**
 * One-line transient message that clears itself after a while.
 * Every caller was re-writing the same `setTimeout(() => msg = '')` pair.
 */
export function useStatusMessage() {
  const message = ref('');
  let timer: number | null = null;

  function show(text: string, durationMs = 3000): void {
    if (timer !== null) clearTimeout(timer);
    message.value = text;
    timer = window.setTimeout(() => {
      timer = null;
      message.value = '';
    }, durationMs);
  }

  function clear(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    message.value = '';
  }

  onUnmounted(clear);

  return { message, show, clear };
}
