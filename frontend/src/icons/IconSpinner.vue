<script setup>
defineProps({
  size: { type: [Number, String], default: 16 },
  strokeWidth: { type: Number, default: 2 },
})
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" class="spin-path" />
  </svg>
</template>
