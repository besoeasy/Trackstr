/**
 * Review Suggestions Generator
 * Provides a pool of 100+ combinations of nouns and verbs for 1-click quick reviews.
 * Includes patterns like:
 *  - Modal + Verb: "Must watch", "Must see", "Must follow", "Must listen", "Must binge"
 *  - Must-[Verb] [Noun]: "Must-watch masterpiece", "Must-see classic", "Must-hear soundtrack"
 *  - Verb + [Noun]: "Captures the atmosphere", "Elevates the story", "Defies expectations"
 *  - [Noun] + Verb: "Story delivers", "Cast excels", "Visuals stun", "Soundtrack hits"
 *  - Punchy Curated: "Absolute masterpiece", "Instant classic", "Peak cinema", "Total letdown"
 */

export const MODAL_VERB_SUGGESTIONS = [
  'Must watch',
  'Must see',
  'Must follow',
  'Must listen',
  'Must hear',
  'Must experience',
  'Must rewatch',
  'Must binge',
  'Must stream',
  'Must recommend',
  'Must revisit',
  'Must savor',
  'Worth watching',
  'Worth seeing',
  'Worth listening',
  'Worth streaming',
  'Worth experiencing',
  'Skip watching',
  'Recommend watching',
  'Ready to rewatch',
  'Love to rewatch',
  'Hard to watch',
  'Easy to follow',
  'Hard to resist',
  'Easy to love',
  'Need to see',
  'Time to binge',
  'Refuse to miss',
  'Cannot recommend enough',
  'Glad I watched'
]

export const COMPOUND_NOUN_VERB_SUGGESTIONS = [
  'Must-watch masterpiece',
  'Must-see classic',
  'Must-follow story',
  'Must-hear soundtrack',
  'Must-binge series',
  'Must-rewatch finale',
  'Must-experience journey',
  'Must-see performance',
  'Must-stream release',
  'Must-watch thriller',
  'Must-listen album',
  'Must-follow narrative',
  'Must-listen melody',
  'Must-experience spectacle'
]

export const VERB_PHRASE_SUGGESTIONS = [
  'Captures the atmosphere',
  'Delivers the emotion',
  'Elevates the story',
  'Defies expectations',
  'Redefines cinema',
  'Sparks pure joy',
  'Hooks the audience',
  'Masters the craft',
  'Holds your attention',
  'Builds incredible tension',
  'Leaves lasting impact',
  'Demands a rewatch',
  'Rewards your patience',
  'Commands the screen',
  'Challenges your perspective',
  'Honors the genre',
  'Amplifies the mood',
  'Hits every beat',
  'Strikes every chord',
  'Crushes the climax',
  'Ignites the imagination',
  'Carries the narrative',
  'Steals the show',
  'Sets the benchmark',
  'Blends style and substance',
  'Wastes great potential',
  'Misses the mark',
  'Keeps you guessing',
  'Touches your heart',
  'Provokes deep thought',
  'Transcends ordinary storytelling',
  'Overcomes slow pacing',
  'Resonates on every level',
  'Hits all the right notes',
  'Exceeds all expectations'
]

export const NOUN_PHRASE_SUGGESTIONS = [
  'Story delivers',
  'Cast excels',
  'Acting shines',
  'Visuals stun',
  'Soundtrack hits',
  'Music resonates',
  'Dialogue sparkles',
  'Atmosphere grips',
  'Characters evolve',
  'Ending satisfies',
  'Performance captivates',
  'Cinematography dazzles',
  'Direction inspires',
  'Tension builds',
  'Emotion overflows',
  'Magic unfolds',
  'Chemistry sizzles',
  'Humor lands',
  'Score transcends',
  'Detail impresses',
  'Ambience enchants',
  'Worldbuilding immerses',
  'Climax delivers',
  'Plot twists surprise',
  'Pacing drags',
  'Script falters',
  'Writing disappoints',
  'Vibe lingers',
  'Heart shines through',
  'Impact endures',
  'Production dazzles',
  'Artistry shows',
  'Execution triumphs',
  'Concept fascinates',
  'Finale stuns'
]

export const CURATED_CLASSIC_SUGGESTIONS = [
  'Absolute masterpiece',
  'Instant classic',
  'Peak cinema',
  'Pure brilliance',
  'Total letdown',
  'Emotional rollercoaster',
  'Visual feast',
  'Sonic perfection',
  'Edge of your seat',
  'Hidden gem',
  'Flawless execution',
  'Masterclass in storytelling',
  'Highly recommended',
  'Overrated hype',
  'Slow burn perfection',
  'Left me speechless',
  'Could not stop watching',
  'Timeless classic',
  'Needs a rewatch',
  'Hard pass'
]

/**
 * Universal pool containing 130+ combinations of nouns and verbs.
 */
export const REVIEW_SUGGESTIONS_POOL = Array.from(
  new Set([
    ...MODAL_VERB_SUGGESTIONS,
    ...COMPOUND_NOUN_VERB_SUGGESTIONS,
    ...VERB_PHRASE_SUGGESTIONS,
    ...NOUN_PHRASE_SUGGESTIONS,
    ...CURATED_CLASSIC_SUGGESTIONS
  ])
)

/**
 * Music-specific suggestions pool prioritizing audio/listening verbs and nouns.
 */
export const MUSIC_SUGGESTIONS_POOL = Array.from(
  new Set([
    'Must listen',
    'Must hear',
    'Must follow',
    'Must experience',
    'Must revisit',
    'Worth listening',
    'Soundtrack hits',
    'Score transcends',
    'Music resonates',
    'Hits every note',
    'Strikes every chord',
    'Melody lingers',
    'Must-listen album',
    'Must-hear soundtrack',
    'Sonic perfection',
    'Vibe lingers',
    'Heart shines through',
    'Instant classic',
    'Absolute masterpiece',
    'Pure brilliance',
    'Highly recommended',
    'Amplifies the mood',
    'Captures the atmosphere',
    'Leaves lasting impact',
    'Resonates on every level',
    'Magic unfolds',
    'Emotion overflows'
  ])
)

/**
 * Gets the suggestion pool tailored for a specific media type.
 * Always guarantees 100+ combinations available.
 * @param {string} [mediaType] 'movie' | 'show' | 'episode' | 'music'
 * @returns {string[]} Array of suggestions
 */
export function getReviewSuggestionsPool(mediaType = 'movie') {
  if (mediaType === 'music') {
    return Array.from(new Set([...MUSIC_SUGGESTIONS_POOL, ...REVIEW_SUGGESTIONS_POOL]))
  }
  return REVIEW_SUGGESTIONS_POOL
}

/**
 * Randomly samples unique review suggestions from the pool.
 * @param {number} [count=5] Number of suggestions to return (default 5)
 * @param {string} [mediaType='movie'] Media type for domain filtering
 * @param {string[]} [exclude=[]] Suggestions to exclude (e.g. currently displayed)
 * @returns {string[]} Array of random suggestions
 */
export function getRandomReviewSuggestions(count = 5, mediaType = 'movie', exclude = []) {
  const pool = getReviewSuggestionsPool(mediaType)
  const excludeSet = new Set(exclude || [])
  const candidates = pool.filter((item) => !excludeSet.has(item))
  const source = candidates.length >= count ? candidates : pool

  const shuffled = [...source]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = temp
  }

  return shuffled.slice(0, Math.min(count, shuffled.length))
}
