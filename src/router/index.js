import { createRouter, createWebHistory, createMemoryHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import MediaDetailView from '@/views/MediaDetailView.vue'
import LibraryView from '@/views/LibraryView.vue'
import ActivityView from '@/views/ActivityView.vue'
import ConnectView from '@/views/ConnectView.vue'
import SettingsView from '@/views/SettingsView.vue'
import TrackMediaView from '@/views/TrackMediaView.vue'
import ImportView from '@/views/ImportView.vue'

const routes = [
  {
    path: '/',
    name: 'home',
    component: HomeView,
  },
  {
    path: '/search',
    name: 'search',
    component: HomeView,
  },
  {
    path: '/connect',
    name: 'connect',
    alias: '/login',
    component: ConnectView,
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsView,
  },
  {
    path: '/import',
    name: 'import',
    alias: '/sync/import',
    component: ImportView,
  },
  {
    path: '/track',
    name: 'track',
    alias: '/add',
    component: TrackMediaView,
  },
  {
    path: '/media/:contentId',
    name: 'media-detail',
    component: MediaDetailView,
  },
  {
    path: '/library',
    name: 'library',
    component: LibraryView,
  },
  {
    path: '/activity',
    name: 'activity',
    component: ActivityView,
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
