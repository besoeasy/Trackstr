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
    it('throws when mandatory Title column is missing', () => {
      const csv = `Year,Type\n1999,movie`
      expect(() => parseCsvFile(csv)).toThrow(/missing mandatory column.*Title/i)
    })

    it('throws when Name is used instead of strictly Title', () => {
      const csv = `Name,Year,Type\nFight Club,1999,movie`
      expect(() => parseCsvFile(csv)).toThrow(/missing mandatory column.*Title/i)
    })

    it('throws when mandatory Year column is missing', () => {
      const csv = `Title,Type\nFight Club,movie`
      expect(() => parseCsvFile(csv)).toThrow(/missing mandatory column.*Year/i)
    })

    it('throws when mandatory Type column is missing', () => {
      const csv = `Title,Year\nFight Club,1999`
      expect(() => parseCsvFile(csv)).toThrow(/missing mandatory column.*Type/i)
    })

    it('parses Trackstr standard CSV with Title, Year, Type, Rating, and Review', () => {
      const csv = `Title,Year,Type,Rating,Review,Spoiler\nDune,2021,movie,9,Epic visuals!,yes`
      const items = parseCsvFile(csv, 'dune.csv')
      expect(items.length).toBe(1)
      expect(items[0].name).toBe('Dune')
      expect(items[0].title).toBe('Dune')
      expect(items[0].year).toBe(2021)
      expect(items[0].type).toBe('movie')
      expect(items[0].rating).toBe(9)
      expect(items[0].review).toBe('Epic visuals!')
      expect(items[0].spoiler).toBe(true)
    })

    it('parses Trackstr standard multi-media CSV format (movies, shows, music)', () => {
      const csv = [
        'Title,Year,Type,Artist,Status,Rating,Review,Date,Spoiler',
        'Fight Club,1999,movie,,completed,8,Timeless classic,1999-10-15,no',
        'Severance,2022,show,,watching,9.5,Mesmerizing mystery,2022-03-01,false',
        'OK Computer,1997,music,Radiohead,completed,10,Iconic album,1997-05-21,0',
        'Inception,2010,movie,,plan-to-watch,,,,',
      ].join('\n')

      const items = parseCsvFile(csv, 'trackstr_export.csv')
      expect(items.length).toBe(4)

      // Movie
      expect(items[0].name).toBe('Fight Club')
      expect(items[0].year).toBe(1999)
      expect(items[0].type).toBe('movie')
      expect(items[0].status).toBe('completed')
      expect(items[0].rating).toBe(8)
      expect(items[0].review).toBe('Timeless classic')
      expect(items[0].spoiler).toBe(false)

      // Show
      expect(items[1].name).toBe('Severance')
      expect(items[1].year).toBe(2022)
      expect(items[1].type).toBe('show')
      expect(items[1].status).toBe('watching')
      expect(items[1].rating).toBe(9.5)

      // Music
      expect(items[2].name).toBe('OK Computer')
      expect(items[2].year).toBe(1997)
      expect(items[2].type).toBe('music')
      expect(items[2].artist).toBe('Radiohead')
      expect(items[2].status).toBe('completed')
      expect(items[2].rating).toBe(10)

      // Plan to watch
      expect(items[3].name).toBe('Inception')
      expect(items[3].status).toBe('plan-to-watch')
    })

    it('skips rows missing valid 4-digit Year, Title, or Type, and reports skippedCount', () => {
      const csv = [
        'Title,Year,Type,Artist',
        'Valid Movie,2020,movie,',
        'Missing Year,,movie,',
        ',2021,movie,',
        'Invalid Year,not-a-year,movie,',
        'Invalid Type,2020,unknown,',
        'Missing Type,2020,,',
        'Music Without Artist,2022,music,',
      ].join('\n')

      const items = parseCsvFile(csv)
      expect(items.length).toBe(1)
      expect(items[0].name).toBe('Valid Movie')
      expect(items.skippedCount).toBe(6)
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

    it('skips items missing title or valid 4-digit year and tracks skippedCount', () => {
      const json = [
        { movie: { title: 'Valid Movie', year: 2021 } },
        { movie: { title: '', year: 2021 } },
        { movie: { title: 'No Year' } },
        { show: { title: 'Bad Year Show', year: 'invalid' } },
      ]
      const items = parseTraktJson(json)
      expect(items.length).toBe(1)
      expect(items[0].name).toBe('Valid Movie')
      expect(items.skippedCount).toBe(3)
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
