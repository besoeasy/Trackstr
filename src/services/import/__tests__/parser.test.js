import { describe, it, expect } from 'vitest'
import {
  parseCsv,
  convertLetterboxdRating,
  normalizeDate,
  detectLetterboxdFileType,
  parseCsvFile,
  parseTraktJson,
  consolidateMediaItems,
} from '../parser.js'

describe('Media Importer Parsers', () => {
  describe('parseCsv() RFC 4180', () => {
    it('parses basic comma-separated rows', () => {
      const csv = 'Name,Year\nFight Club,1999\nInception,2010'
      const rows = parseCsv(csv)
      expect(rows).toEqual([
        ['Name', 'Year'],
        ['Fight Club', '1999'],
        ['Inception', '2010'],
      ])
    })

    it('handles commas inside quotes', () => {
      const csv = 'Name,Year\n"Everything Everywhere All at Once, The Sequel",2024'
      const rows = parseCsv(csv)
      expect(rows[1][0]).toBe('Everything Everywhere All at Once, The Sequel')
      expect(rows[1][1]).toBe('2024')
    })

    it('handles escaped quotes "" within quoted fields', () => {
      const csv = 'Name,Review\nMovie,"He said ""Mind blowing!"" and left."'
      const rows = parseCsv(csv)
      expect(rows[1][1]).toBe('He said "Mind blowing!" and left.')
    })

    it('handles newlines inside quoted reviews', () => {
      const csv = 'Name,Review\nInception,"First line\nSecond line"'
      const rows = parseCsv(csv)
      expect(rows[1][1]).toBe('First line\nSecond line')
    })

    it('handles CRLF line endings cleanly', () => {
      const csv = 'Name,Year\r\nMovie A,2020\r\nMovie B,2021\r\n'
      const rows = parseCsv(csv)
      expect(rows.length).toBe(3)
      expect(rows[1][0]).toBe('Movie A')
      expect(rows[2][0]).toBe('Movie B')
    })
  })

  describe('convertLetterboxdRating()', () => {
    it('scales 0.5 to 5.0 stars to 1 to 10 points', () => {
      expect(convertLetterboxdRating('0.5')).toBe(1)
      expect(convertLetterboxdRating('1.0')).toBe(2)
      expect(convertLetterboxdRating('2.5')).toBe(5)
      expect(convertLetterboxdRating('4.0')).toBe(8)
      expect(convertLetterboxdRating('4.5')).toBe(9)
      expect(convertLetterboxdRating('5.0')).toBe(10)
    })

    it('preserves valid 10-point ratings directly', () => {
      expect(convertLetterboxdRating('7.5')).toBe(7.5)
      expect(convertLetterboxdRating('10')).toBe(10)
    })

    it('returns null for empty or invalid ratings', () => {
      expect(convertLetterboxdRating('')).toBeNull()
      expect(convertLetterboxdRating(null)).toBeNull()
      expect(convertLetterboxdRating('abc')).toBeNull()
      expect(convertLetterboxdRating('0')).toBeNull()
    })
  })

  describe('normalizeDate()', () => {
    it('preserves YYYY-MM-DD format', () => {
      expect(normalizeDate('2023-05-18')).toBe('2023-05-18')
    })

    it('converts parseable date strings', () => {
      const d = normalizeDate('May 18, 2023')
      expect(d).toBe('2023-05-18')
    })

    it('returns empty string on invalid dates', () => {
      expect(normalizeDate('')).toBe('')
      expect(normalizeDate('not-a-date')).toBe('')
    })
  })

  describe('detectLetterboxdFileType()', () => {
    it('detects watched, ratings, reviews, and watchlist correctly', () => {
      expect(detectLetterboxdFileType(['Date', 'Name', 'Year', 'Letterboxd URI'], 'watched.csv')).toBe('watched')
      expect(detectLetterboxdFileType(['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating'], 'ratings.csv')).toBe('ratings')
      expect(detectLetterboxdFileType(['Date', 'Name', 'Year', 'Letterboxd URI', 'Review'], 'reviews.csv')).toBe('reviews')
      expect(detectLetterboxdFileType(['Date', 'Name', 'Year', 'Letterboxd URI'], 'watchlist.csv')).toBe('watchlist')
    })
  })

  describe('parseCsvFile()', () => {
    it('parses Letterboxd watched.csv', () => {
      const csv = `Date,Name,Year,Letterboxd URI\n2024-01-10,Dune,2021,https://boxd.it/a1\n2024-02-15,Oppenheimer,2023,https://boxd.it/a2`
      const items = parseCsvFile(csv, 'watched.csv')
      expect(items.length).toBe(2)
      expect(items[0].name).toBe('Dune')
      expect(items[0].year).toBe(2021)
      expect(items[0].status).toBe('completed')
    })

    it('parses Letterboxd ratings.csv with star conversion', () => {
      const csv = `Date,Name,Year,Letterboxd URI,Rating\n2024-01-10,Dune,2021,https://boxd.it/a1,4.5`
      const items = parseCsvFile(csv, 'ratings.csv')
      expect(items.length).toBe(1)
      expect(items[0].rating).toBe(9)
    })

    it('parses Letterboxd reviews.csv with spoiler detection', () => {
      const csv = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date,Spoiler\n2024-01-10,Dune,2021,https://boxd.it/a1,4.5,,Epic visuals!,,2024-01-09,Yes`
      const items = parseCsvFile(csv, 'reviews.csv')
      expect(items.length).toBe(1)
      expect(items[0].review).toBe('Epic visuals!')
      expect(items[0].spoiler).toBe(true)
    })

    it('parses Letterboxd watchlist.csv with plan-to-watch status', () => {
      const csv = `Date,Name,Year,Letterboxd URI\n2024-03-01,Gladiator II,2024,https://boxd.it/a3`
      const items = parseCsvFile(csv, 'watchlist.csv')
      expect(items.length).toBe(1)
      expect(items[0].status).toBe('plan-to-watch')
    })
  })

  describe('parseTraktJson()', () => {
    it('parses Trakt history JSON', () => {
      const json = [
        {
          watched_at: '2023-01-15T12:00:00.000Z',
          movie: { title: 'Inception', year: 2010 },
          rating: 9,
        },
      ]
      const items = parseTraktJson(json)
      expect(items.length).toBe(1)
      expect(items[0].name).toBe('Inception')
      expect(items[0].year).toBe(2010)
      expect(items[0].rating).toBe(9)
    })
  })

  describe('consolidateMediaItems()', () => {
    it('merges entries across watched, ratings, and reviews files for the same film', async () => {
      const parsedItems = [
        { type: 'movie', name: 'Inception', year: 2010, status: 'completed', rating: null, review: '', spoiler: false },
        { type: 'movie', name: 'Inception', year: 2010, status: 'completed', rating: 9, review: '', spoiler: false },
        { type: 'movie', name: 'Inception', year: 2010, status: 'completed', rating: null, review: 'Brilliant.', spoiler: false },
      ]

      const consolidated = await consolidateMediaItems(parsedItems)
      expect(consolidated.length).toBe(1)
      expect(consolidated[0].name).toBe('Inception')
      expect(consolidated[0].rating).toBe(9)
      expect(consolidated[0].review).toBe('Brilliant.')
      expect(consolidated[0].contentId).toBeDefined()
      expect(consolidated[0].contentId.length).toBe(64)
    })
  })
})
