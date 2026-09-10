import puppeteer from 'puppeteer'
import path from 'path'
import fs from 'fs'

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173'
const SCREENSHOT_PATH = path.resolve('scratch/review-suggestions-modal.png')
const SCREENSHOT_MOBILE_PATH = path.resolve('scratch/review-suggestions-mobile.png')

fs.mkdirSync(path.resolve('scratch'), { recursive: true })

async function runTest() {
  console.log('🚀 Launching Puppeteer to test 1-Click Review Suggestions...')
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1000, height: 800 })

    const testUrl = `${BASE_URL}/media/5d974f7d08efef728f3e77f6f910291782d657b47a37374045b89301c6ee1f30?title=Fight%20Club&year=1999&type=movie`
    await page.goto(testUrl, { waitUntil: 'networkidle2', timeout: 15000 })

    // Simulate authenticated session
    await page.evaluate(() => {
      localStorage.setItem('trackstr_pubkey', '5d974f7d08efef728f3e77f6f910291782d657b47a37374045b89301c6ee1f30')
      localStorage.setItem('trackstr_auth_type', 'extension')
    })
    await page.reload({ waitUntil: 'networkidle2' })
    await new Promise((r) => setTimeout(r, 600))

    // Click "Write a review" (✍️ button)
    console.log('Clicking "Write a review" button...')
    const reviewBtn = await page.$('.add-review-btn')
    if (!reviewBtn) {
      throw new Error('Could not find .add-review-btn on media detail view')
    }
    await reviewBtn.click()
    await new Promise((r) => setTimeout(r, 400))

    // Check review modal is visible
    const modal = await page.$('.review-modal')
    if (!modal) {
      throw new Error('Review modal did not open')
    }
    console.log('✅ Review modal opened successfully')

    // Check suggestions container and count of suggestion chips
    const chips = await page.$$('.suggestion-chip')
    console.log(`Found ${chips.length} suggestion chips in modal`)
    if (chips.length !== 5) {
      throw new Error(`Expected 5 suggestion chips, got ${chips.length}`)
    }

    const chipTexts = await page.$$eval('.suggestion-chip', (els) => els.map((el) => el.textContent.trim()))
    console.log('Initial 5 suggestions:', chipTexts)

    // Verify all 5 are non-empty and unique
    const unique = new Set(chipTexts)
    if (unique.size !== 5) {
      throw new Error('Expected 5 unique suggestions, found duplicates')
    }

    // 1-Click test: Click 1st suggestion chip
    console.log(`Clicking 1st suggestion chip: "${chipTexts[0]}"...`)
    await chips[0].click()
    await new Promise((r) => setTimeout(r, 200))

    // Check textarea value
    let textareaVal = await page.$eval('.review-modal-textarea', (el) => el.value)
    console.log(`Textarea value after 1st click: "${textareaVal}"`)
    if (textareaVal !== chipTexts[0]) {
      throw new Error(`Textarea value mismatch! Expected "${chipTexts[0]}", got "${textareaVal}"`)
    }

    // Check chip-selected class on 1st chip
    const isFirstSelected = await chips[0].evaluate((el) => el.classList.contains('chip-selected'))
    if (!isFirstSelected) {
      throw new Error('Expected 1st chip to have .chip-selected class')
    }
    console.log('✅ 1-click populated textarea and marked chip as selected')

    // Click 2nd suggestion chip
    console.log(`Clicking 2nd suggestion chip: "${chipTexts[1]}"...`)
    await chips[1].click()
    await new Promise((r) => setTimeout(r, 200))

    textareaVal = await page.$eval('.review-modal-textarea', (el) => el.value)
    console.log(`Textarea value after 2nd click: "${textareaVal}"`)
    const expectedAppended = `${chipTexts[0]}. ${chipTexts[1]}`
    if (textareaVal !== expectedAppended) {
      throw new Error(`Textarea value mismatch after 2nd click! Expected "${expectedAppended}", got "${textareaVal}"`)
    }
    console.log('✅ 2nd chip appended cleanly with punctuation')

    // Test Shuffle button
    console.log('Clicking "🔄 Shuffle" button...')
    const shuffleBtn = await page.$('.btn-refresh-suggestions')
    if (!shuffleBtn) {
      throw new Error('Could not find .btn-refresh-suggestions')
    }
    await shuffleBtn.click()
    await new Promise((r) => setTimeout(r, 200))

    const newChipTexts = await page.$$eval('.suggestion-chip', (els) => els.map((el) => el.textContent.trim()))
    console.log('Shuffled 5 suggestions:', newChipTexts)
    if (newChipTexts.length !== 5) {
      throw new Error(`Expected 5 suggestions after shuffle, got ${newChipTexts.length}`)
    }

    // Take desktop screenshot
    await page.screenshot({ path: SCREENSHOT_PATH })
    console.log(`Saved screenshot to ${SCREENSHOT_PATH}`)

    // Test mobile layout
    console.log('Testing mobile layout at 375x667...')
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true })
    await new Promise((r) => setTimeout(r, 400))

    let mobileModal = await page.$('.review-modal')
    if (!mobileModal) {
      await page.evaluate(() => {
        const btn = document.querySelector('.add-review-btn')
        if (btn) btn.click()
      })
      await page.waitForSelector('.review-modal', { timeout: 4000 }).catch(() => null)
      mobileModal = await page.$('.review-modal')
    }

    if (!mobileModal) {
      throw new Error('Review modal not found on mobile')
    }

    // Check for modal horizontal overflow
    const modalOverflow = await page.evaluate(() => {
      const el = document.querySelector('.review-modal')
      return el ? el.scrollWidth > el.clientWidth + 1 : false
    })
    if (modalOverflow) {
      throw new Error('Review modal has horizontal overflow on mobile')
    }

    await page.screenshot({ path: SCREENSHOT_MOBILE_PATH })
    console.log(`Saved mobile screenshot to ${SCREENSHOT_MOBILE_PATH}`)

    console.log('🎉 All review suggestion tests passed successfully!')
  } finally {
    await browser.close()
  }
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})
