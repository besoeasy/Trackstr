import { createRouter, createWebHistory, createMemoryHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
  },
  {
    path: '/search',
    name: 'search',
    component: () => import('@/views/HomeView.vue'),
  },
  {
    path: '/connect',
    name: 'connect',
    alias: '/login',
    component: () => import('@/views/ConnectView.vue'),
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
  },
  {
    path: '/import',
    name: 'import',
    alias: '/sync/import',
    component: () => import('@/views/ImportView.vue'),
  },
  {
    path: '/track',
    name: 'track',
    alias: '/add',
    component: () => import('@/views/TrackMediaView.vue'),
  },
  {
    path: '/media/:contentId',
    name: 'media-detail',
    component: () => import('@/views/MediaDetailView.vue'),
  },
  {
    path: '/library',
    name: 'library',
    component: () => import('@/views/LibraryView.vue'),
  },
  {
    path: '/activity',
    name: 'activity',
    component: () => import('@/views/ActivityView.vue'),
  },
  // Unknown paths land home instead of rendering a bare navbar.
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

const router = createRouter({
  history: typeof window !== 'undefined' ? createWebHistory(import.meta.env.BASE_URL) : createMemoryHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

export default router
