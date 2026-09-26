<script setup>
import { IconSun, IconMoon } from '../icons/index.js'

defineProps({ theme: { type: String, required: true } })
defineEmits(['toggle'])
</script>

<template>
  <button
    class="theme-toggle btn btn-ghost"
    :title="theme === 'dark' ? '切换到浅色' : '切换到深色'"
    :aria-label="theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'"
    @click="$emit('toggle')"
  >
    <Transition name="theme-icon" mode="out-in">
      <IconMoon v-if="theme === 'dark'" key="moon" :size="16" />
      <IconSun v-else key="sun" :size="16" />
    </Transition>
  </button>
</template>

<style scoped>
.theme-toggle {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
}

.theme-icon-enter-active,
.theme-icon-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-standard),
    transform var(--dur-fast) var(--ease-standard);
}

.theme-icon-enter-from {
  opacity: 0;
  transform: rotate(-90deg) scale(0.8);
}

.theme-icon-leave-to {
  opacity: 0;
  transform: rotate(90deg) scale(0.8);
}
</style>
