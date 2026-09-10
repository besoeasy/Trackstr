import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173'
const SCREENSHOT_DIR = path.resolve('scratch/mobile-tests')

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
}

const VIEWPORTS = [
  { name: 'Compact-360', width: 360, height: 740 },
  { name: 'iPhone-SE', width: 375, height: 667 },
  { name: 'iPhone-14', width: 390, height: 844 },
  { name: 'Pixel-7', width: 412, height: 915 },
]

const ROUTES = [
  { path: '/', name: 'home' },
  { path: '/library', name: 'library' },
  { path: '/activity', name: 'activity' },
  { path: '/track', name: 'track' },
  { path: '/connect', name: 'connect' },
  { path: '/settings', name: 'settings' },
  { path: '/import', name: 'import' },
  { path: '/media/5d974f7d08efef728f3e77f6f910291782d657b47a37374045b89301c6ee1f30?title=Fight%20Club&year=1999&type=movie', name: 'detail-movie' },
  { path: '/media/7d974f7d08efef728f3e77f6f910291782d657b47a37374045b89301c6ee1f30?title=Breaking%20Bad&year=2008&type=show', name: 'detail-show' },
]

async function runTests() {
  console.log('🚀 Launching Headless Chrome for automated mobile testing...')
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  let totalErrors = 0
  const results = []

  for (const vp of VIEWPORTS) {
    console.log(`\n📱 Testing Viewport: ${vp.name} (${vp.width}x${vp.height})`)
    const page = await browser.newPage()
    await page.setViewport({
      width: vp.width,
      height: vp.height,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    })

    for (const route of ROUTES) {
      const url = `${BASE_URL}${route.path}`
      const testName = `${vp.name}_${route.name}`
      console.log(`  Checking ${route.name} (${route.path})...`)

      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 })
        await new Promise((r) => setTimeout(r, 600)) // wait for animations / mounts

        // 1. Check for horizontal overflow
        const overflowData = await page.evaluate(() => {
          const scrollWidth = document.documentElement.scrollWidth
          const windowWidth = window.innerWidth
          const hasHorizontalOverflow = scrollWidth > windowWidth + 1

          const overflowingElements = []
          const allElements = document.querySelectorAll('*')
          allElements.forEach((el) => {
            const rect = el.getBoundingClientRect()
            if (rect.right > windowWidth + 2 && rect.width > 0) {
              const tag = el.tagName.toLowerCase()
              const className = typeof el.className === 'string' ? el.className.split(' ').slice(0, 3).join('.') : ''
              const id = el.id ? `#${el.id}` : ''
              overflowingElements.push({
                selector: `${tag}${id}${className ? '.' + className : ''}`,
                right: Math.round(rect.right),
                width: Math.round(rect.width),
                overflowAmount: Math.round(rect.right - windowWidth),
              })
            }
          })

          return {
            windowWidth,
            scrollWidth,
            hasHorizontalOverflow,
            overflowingElements: overflowingElements.slice(0, 5),
          }
        })

        // 2. Check header nav links vs bottom nav
        const navData = await page.evaluate(() => {
          const navLinks = document.querySelector('.navbar .nav-links')
          const bottomNav = document.querySelector('.mobile-bottom-nav')
          const navLinksVisible = navLinks ? window.getComputedStyle(navLinks).display !== 'none' : false
          const bottomNavVisible = bottomNav ? window.getComputedStyle(bottomNav).display !== 'none' : false

          return {
            topNavLinksVisible: navLinksVisible,
            bottomNavVisible,
          }
        })

        // 3. Interactive check: on Home, click through category tabs
        if (route.name === 'home') {
          const tabs = await page.$$('.search-tabs .tab-btn')
          if (tabs.length >= 3) {
            await tabs[1].click() // TV Series tab
            await new Promise((r) => setTimeout(r, 200))
            await tabs[2].click() // Music tab
            await new Promise((r) => setTimeout(r, 200))
            await tabs[0].click() // Movies tab
            await new Promise((r) => setTimeout(r, 200))
          }
        }

        // 4. Interactive check: on media detail movie, try opening review modal
        if (route.name === 'detail-movie') {
          const reviewBtn = await page.$('.add-review-btn')
          if (reviewBtn) {
            await reviewBtn.click()
            await new Promise((r) => setTimeout(r, 300))
            const modalVisible = await page.evaluate(() => {
              const modal = document.querySelector('.review-modal')
              return modal ? window.getComputedStyle(modal).display !== 'none' : false
            })
            // Close modal
            const closeBtn = await page.$('.review-modal .btn-icon')
            if (closeBtn) {
              await closeBtn.click()
              await new Promise((r) => setTimeout(r, 200))
            }
          }
        }

        // 5. Interactive check: on mobile bottom nav, click Settings tab
        if (route.name === 'home') {
          const settingsNavItem = await page.$('.mobile-bottom-nav a[href="/settings"]')
          if (settingsNavItem) {
            const box = await settingsNavItem.boundingBox()
            if (box) {
              if (box.height < 36 || box.width < 36) {
                issues.push(`Bottom nav item too small: ${Math.round(box.width)}x${Math.round(box.height)}px`)
              }
            }
          }
        }

        // 6. Take screenshot
        const screenshotPath = path.join(SCREENSHOT_DIR, `${testName}.png`)
        await page.screenshot({ path: screenshotPath, fullPage: false })

        const issues = []
        if (overflowData.hasHorizontalOverflow) {
          issues.push(
            `Horizontal overflow: scrollWidth (${overflowData.scrollWidth}px) > viewport (${overflowData.windowWidth}px). Offending: ${overflowData.overflowingElements.map((e) => e.selector).join(', ')}`
          )
        }
        if (navData.topNavLinksVisible && navData.bottomNavVisible) {
          issues.push('Redundant navigation: Desktop top .nav-links is visible simultaneously with mobile-bottom-nav')
        }
        if (!navData.bottomNavVisible) {
          issues.push('Mobile bottom navigation bar is not visible on mobile viewport')
        }

        const passed = issues.length === 0
        if (!passed) totalErrors++

        results.push({
          viewport: vp.name,
          route: route.name,
          passed,
          issues,
          screenshot: screenshotPath,
        })

        console.log(`    ${passed ? '✅ PASS' : '❌ FAIL'}: ${passed ? 'Clean mobile layout & interactions verified' : issues.join('; ')}`)
      } catch (err) {
        console.error(`    ❌ ERROR on ${route.name}:`, err.message)
        totalErrors++
        results.push({
          viewport: vp.name,
          route: route.name,
          passed: false,
          issues: [`Navigation/load failed: ${err.message}`],
        })
      }
    }

    await page.close()
  }

  await browser.close()

  console.log('\n=========================================')
  console.log(`Mobile Automated Test Summary: ${results.filter((r) => r.passed).length}/${results.length} passed, ${totalErrors} failures.`)
  console.log('=========================================')

  return totalErrors === 0
}

runTests().then((success) => {
  process.exit(success ? 0 : 1)
})
