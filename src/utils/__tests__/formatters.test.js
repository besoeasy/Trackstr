import { describe, it, expect } from 'vitest'
import { formatStatus, getStatusColorClass, formatRelativeTime } from '@/utils/formatters.js'

describe('formatStatus()', () => {
  it('maps every canonical status', () => {
    expect(formatStatus('plan-to-watch')).toBe('Plan to Watch')
    expect(formatStatus('watching')).toBe('Watching')
    expect(formatStatus('completed')).toBe('Completed')
    expect(formatStatus('on-hold')).toBe('On Hold')
    expect(formatStatus('dropped')).toBe('Dropped')
    expect(formatStatus('plan-to-listen')).toBe('Plan to Listen')
    expect(formatStatus('listening')).toBe('Listening')
  })

  it('falls back safely for empty/unknown input', () => {
    expect(formatStatus('')).toBe('Not Tracked')
    expect(formatStatus('archived')).toBe('Unknown')
  })
})

describe('getStatusColorClass()', () => {
  it('maps statuses to badge classes with a neutral default', () => {
    expect(getStatusColorClass('completed')).toBe('badge-success')
    expect(getStatusColorClass('watching')).toBe('badge-primary')
    expect(getStatusColorClass('plan-to-watch')).toBe('badge-info')
    expect(getStatusColorClass('on-hold')).toBe('badge-warning')
    expect(getStatusColorClass('dropped')).toBe('badge-danger')
    expect(getStatusColorClass('whatever')).toBe('badge-neutral')
  })
})

describe('formatRelativeTime()', () => {
  it('formats recent timestamps', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(formatRelativeTime(now - 10)).toBe('just now')
    expect(formatRelativeTime(now - 120)).toBe('2m ago')
    expect(formatRelativeTime(now - 7200)).toBe('2h ago')
    expect(formatRelativeTime(0)).toBe('')
  })
})
