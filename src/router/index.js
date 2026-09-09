import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import MediaDetailView from '@/views/MediaDetailView.vue'
import LibraryView from '@/views/LibraryView.vue'
import ActivityView from '@/views/ActivityView.vue'

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
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

export default router
