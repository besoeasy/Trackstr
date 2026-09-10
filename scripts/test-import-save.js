import puppeteer from 'puppeteer'
import path from 'path'
import fs from 'fs'

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173'
const SCREENSHOT_PATH = path.resolve('scratch/import-save-success.png')

async function runTest() {
  console.log('🚀 Launching Puppeteer to test "Save to Local Library" into IndexedDB...')
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1000, height: 800 })

    // Listen to console errors or uncaught exceptions
    const errors = []
    page.on('pageerror', (err) => {
      console.error('Browser Page Error:', err.message)
      errors.push(err.message)
    })
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log('Browser console.error:', msg.text())
      }
    })

    await page.goto(`${BASE_URL}/import`, { waitUntil: 'networkidle2', timeout: 15000 })

    // Prepare sample Letterboxd CSV files
    const watchedCsv = `Date,Name,Year,Letterboxd URI
2023-01-15,Fight Club,1999,https://boxd.it/2a9q
2023-02-20,The Matrix,1999,https://boxd.it/2a9r
2023-03-10,Inception,2010,https://boxd.it/17ac
`
    const ratingsCsv = `Date,Name,Year,Letterboxd URI,Rating
2023-01-15,Fight Club,1999,https://boxd.it/2a9q,5.0
2023-02-20,The Matrix,1999,https://boxd.it/2a9r,4.5
`

    // Inject files via file input using DataTransfer/File evaluate
    console.log('Simulating file drop/upload with CSV data...')
    await page.evaluate(({ watchedCsv, ratingsCsv }) => {
      const file1 = new File([watchedCsv], 'watched.csv', { type: 'text/csv' })
      const file2 = new File([ratingsCsv], 'ratings.csv', { type: 'text/csv' })

      const input = document.querySelector('input[type="file"]')
      const dt = new DataTransfer()
      dt.items.add(file1)
      dt.items.add(file2)
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, { watchedCsv, ratingsCsv })

    // Wait for parse and preview to render
    await new Promise((r) => setTimeout(r, 1000))

    const previewHeading = await page.$eval('.summary-title', (el) => el.textContent.trim())
    console.log('Found preview heading:', previewHeading)
    if (previewHeading !== 'Import Preview') {
      throw new Error(`Expected "Import Preview", got "${previewHeading}"`)
    }

    const totalMediaCount = await page.$eval('.summary-metrics-grid .metric-value', (el) => el.textContent.trim())
    console.log('Total media parsed in preview:', totalMediaCount)
    if (totalMediaCount !== '3') {
      throw new Error(`Expected 3 total media items in preview, got "${totalMediaCount}"`)
    }

    // Click "🍿 Save to Local Library (Instant)"
    console.log('Clicking "🍿 Save to Local Library (Instant)" button...')
    const saveBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      return btns.find((b) => b.textContent.includes('Save to Local Library'))
    })

    if (!saveBtn) {
      throw new Error('Save to Local Library button not found!')
    }

    await saveBtn.click()
    await new Promise((r) => setTimeout(r, 800))

    // Check for error banner
    const errorBanner = await page.$('.alert-danger')
    if (errorBanner) {
      const errText = await page.evaluate((el) => el.textContent.trim(), errorBanner)
      throw new Error(`Error banner appeared after clicking save: "${errText}"`)
    }

    // Check for success banner
    const successBanner = await page.$('.alert-success')
    if (!successBanner) {
      throw new Error('Expected .alert-success banner after saving to local library, but none was found')
    }

    const successText = await page.evaluate((el) => el.textContent.trim(), successBanner)
    console.log('✅ Success message displayed:', successText)

    if (!successText.includes('Successfully saved 3 media items')) {
      throw new Error(`Unexpected success message text: "${successText}"`)
    }

    // Verify items are actually present in IndexedDB
    const idbItemCount = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('trackstr_db', 1)
        req.onsuccess = (e) => {
          const db = e.target.result
          const tx = db.transaction(['imported_items'], 'readonly')
          const store = tx.objectStore('imported_items')
          const countReq = store.count()
          countReq.onsuccess = () => resolve(countReq.result)
          countReq.onerror = () => reject(countReq.error)
        }
        req.onerror = () => reject(req.error)
      })
    })

    console.log(`IndexedDB stored items count in "imported_items": ${idbItemCount}`)
    if (idbItemCount !== 3) {
      throw new Error(`Expected 3 items in IndexedDB "imported_items", got ${idbItemCount}`)
    }

    // Verify queue entries are also in IndexedDB
    const idbQueueCount = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('trackstr_db', 1)
        req.onsuccess = (e) => {
          const db = e.target.result
          const tx = db.transaction(['sync_queue'], 'readonly')
          const store = tx.objectStore('sync_queue')
          const countReq = store.count()
          countReq.onsuccess = () => resolve(countReq.result)
          countReq.onerror = () => reject(countReq.error)
        }
        req.onerror = () => reject(req.error)
      })
    })

    console.log(`IndexedDB sync_queue entries count: ${idbQueueCount}`)
    // 3 status + 2 rating = 5 queue entries
    if (idbQueueCount < 5) {
      throw new Error(`Expected at least 5 queue entries in IndexedDB, got ${idbQueueCount}`)
    }

    await page.screenshot({ path: SCREENSHOT_PATH })
    console.log(`Saved screenshot to ${SCREENSHOT_PATH}`)

    if (errors.length > 0) {
      throw new Error(`Browser encountered page errors: ${errors.join('; ')}`)
    }

    console.log('🎉 "Save to Local Library" test passed completely without cloning errors!')
  } finally {
    await browser.close()
  }
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})
