import puppeteer from 'puppeteer'
import path from 'path'
import fs from 'fs'

import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173'
const SCREENSHOT_PATH = path.resolve('scratch/empty-review-posted.png')

async function runTest() {
  console.log('🚀 Launching Puppeteer to test submitting a review without compulsory text...')
  const sk = generateSecretKey()
  const nsec = nip19.nsecEncode(sk)
  const pubkey = getPublicKey(sk)
  console.log('Generated test burner account:', pubkey)

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1000, height: 800 })

    const testUrl = `${BASE_URL}/media/5d974f7d08efef728f3e77f6f910291782d657b47a37374045b89301c6ee1f30?title=Fight%20Club&year=1999&type=movie`
    await page.goto(testUrl, { waitUntil: 'networkidle2', timeout: 15000 })

    // Log in with real local nsec signer
    await page.evaluate(({ nsec, pubkey }) => {
      localStorage.setItem('trackstr_pubkey', pubkey)
      localStorage.setItem('trackstr_auth_type', 'nsec')
      localStorage.setItem('trackstr_nsec', nsec)
    }, { nsec, pubkey })

    await page.reload({ waitUntil: 'networkidle2' })
    await new Promise((r) => setTimeout(r, 800))

    // Click "Write a review" (✍️ button)
    console.log('Clicking "Write a review" button...')
    const reviewBtn = await page.$('.add-review-btn')
    if (!reviewBtn) {
      throw new Error('Could not find .add-review-btn')
    }
    await reviewBtn.click()
    await new Promise((r) => setTimeout(r, 400))

    // Ensure review modal is open
    const modal = await page.$('.review-modal')
    if (!modal) {
      throw new Error('Review modal did not open')
    }

    // Verify textarea is completely empty
    const textareaVal = await page.$eval('.review-modal-textarea', (el) => el.value)
    console.log(`Initial textarea value: "${textareaVal}" (empty: ${textareaVal === ''})`)
    if (textareaVal !== '') {
      throw new Error('Expected textarea to be empty')
    }

    // Click "⚡ Sign & Post Review" with EMPTY text
    console.log('Clicking "⚡ Sign & Post Review" button with empty review text...')
    const postBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('.review-modal-actions button'))
      return btns.find((b) => b.textContent.includes('Sign & Post Review'))
    })

    if (!postBtn) {
      throw new Error('Could not find Sign & Post Review button')
    }

    await postBtn.click()
    await new Promise((r) => setTimeout(r, 800))

    // Check that NO error banner ("Please enter your review text.") is displayed
    const errorBanner = await page.$('.error-banner')
    if (errorBanner) {
      const errText = await page.evaluate((el) => el.textContent.trim(), errorBanner)
      throw new Error(`Error banner was shown: "${errText}"`)
    }

    // Check that review modal closed upon successful post
    const modalAfter = await page.$('.review-modal')
    if (modalAfter) {
      throw new Error('Review modal did not close after submitting review')
    }
    console.log('✅ Review modal closed cleanly without error!')

    // Check that the review card was added to the media page
    const reviewCards = await page.$$('.review-card')
    console.log(`Found ${reviewCards.length} review cards on media page`)
    if (reviewCards.length === 0) {
      throw new Error('Expected review card to be displayed on page')
    }

    await page.screenshot({ path: SCREENSHOT_PATH })
    console.log(`Saved screenshot to ${SCREENSHOT_PATH}`)

    console.log('🎉 Empty review submission test passed successfully!')
  } finally {
    await browser.close()
  }
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})
