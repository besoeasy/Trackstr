/**
 * Music Metadata Provider Entrypoint
 * Re-exports unified multi-provider music search combining iTunes, MusicBrainz, and Audius.
 */
export {
  searchMusic,
  searchMusic as searchMusicBrainz,
  searchItunesTracks,
  searchItunesAlbums,
  searchAudius,
  getMusicDetails,
} from './music.js'
