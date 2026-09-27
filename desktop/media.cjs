/* Spotify on the layer: what's playing, and play/pause/skip/seek. It asks the
   Spotify app on this Mac through AppleScript and never opens Spotify unless
   Nate presses play. The cover art comes from Spotify's own image server. */

const { execFile } = require('node:child_process')

const NOW_PLAYING = `
if application "Spotify" is running then
  tell application "Spotify"
    if player state is stopped then return ""
    set t to current track
    return (player state as text) & tab & (name of t) & tab & (artist of t) & tab & (artwork url of t) & tab & (player position as text) & tab & ((duration of t) as text)
  end tell
end if
return ""`

const CONTROLS = { toggle: 'playpause', next: 'next track', previous: 'previous track' }

function osascript(script) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout: 4000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })
}

/* "playing\tSong\tArtist\thttps://i.scdn.co/…\t12.5\t215000" → { playing, title, artist, art,
   position, duration }. Spotify gives the position in seconds (with the Mac's decimal comma
   in some regions) and the length in milliseconds; both come back in seconds. */
function parseNowPlaying(text) {
  const [state, title, artist, art, position, length] = String(text).replace(/\n$/, '').split('\t')
  if (!title) return null
  const seconds = (value) => (Number.isFinite(value) && value > 0 ? value : 0)
  return {
    playing: state === 'playing',
    title,
    artist: artist || '',
    art: /^https:\/\/i\.scdn\.co\//.test(art || '') ? art : '',
    position: seconds(Number(String(position).replace(',', '.'))),
    duration: seconds(Number(length) / 1000),
  }
}

function createMedia({ run = osascript, fetch = globalThis.fetch } = {}) {
  const covers = new Map()

  async function cover(url) {
    if (!url) return ''
    if (!covers.has(url)) {
      const response = await fetch(url, { signal: AbortSignal.timeout(4000) })
      const type = response.headers.get('content-type') || ''
      if (!response.ok || !type.startsWith('image/')) return ''
      covers.set(url, `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`)
      if (covers.size > 20) covers.delete(covers.keys().next().value)
    }
    return covers.get(url)
  }

  async function nowPlaying() {
    const track = parseNowPlaying(await run(NOW_PLAYING).catch(() => ''))
    if (!track) return null
    return { ...track, art: await cover(track.art).catch(() => '') }
  }

  async function control(action) {
    if (!Object.hasOwn(CONTROLS, action)) throw new Error('Unknown media action.')
    await run(`tell application "Spotify" to ${CONTROLS[action]}`)
    return nowPlaying()
  }

  /* Somewhere in the song that's playing now, and nowhere else. */
  async function seek(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new Error('That isn’t a place in this song.')
    const track = parseNowPlaying(await run(NOW_PLAYING))
    if (!track || seconds > track.duration) throw new Error('That isn’t a place in this song.')
    await run(`tell application "Spotify" to set player position to ${seconds.toFixed(2)}`)
    return nowPlaying()
  }

  return { nowPlaying, control, seek }
}

module.exports = { createMedia, parseNowPlaying }
