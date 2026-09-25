<script setup>
defineProps({ theme: { type: String, required: true } })
defineEmits(['toggle'])
</script>

<template>
  <button class="theme-toggle" :title="theme === 'dark' ? '切换到浅色' : '切换到深色'" @click="$emit('toggle')">
    <span v-if="theme === 'dark'">☾</span>
    <span v-else>☀</span>
  </button>
</template>

<style scoped>
.theme-toggle {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 50%;
  font-size: 15px;
  display: grid;
  place-items: center;
}
</style>
