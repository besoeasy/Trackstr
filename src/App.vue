<script setup>
import { onMounted } from 'vue'
import Navbar from '@/components/Navbar.vue'
import { useSettingsStore } from '@/stores/settings.js'

const settingsStore = useSettingsStore()

onMounted(() => {
  // Initialize theme on root
  document.documentElement.setAttribute('data-theme', settingsStore.theme)
})
</script>

<template>
  <div class="app-container">
    <Navbar />
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<style scoped></style>
