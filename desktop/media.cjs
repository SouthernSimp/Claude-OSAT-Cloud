/* Spotify on the layer: what's playing, and play/pause/skip. It asks the
   Spotify app on this Mac through AppleScript and never opens Spotify unless
   Nate presses play. The cover art comes from Spotify's own image server. */

const { execFile } = require('node:child_process')

const NOW_PLAYING = `
if application "Spotify" is running then
  tell application "Spotify"
    if player state is stopped then return ""
    set t to current track
    return (player state as text) & tab & (name of t) & tab & (artist of t) & tab & (artwork url of t)
  end tell
end if
return ""`

const CONTROLS = { toggle: 'playpause', next: 'next track', previous: 'previous track' }

function osascript(script) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout: 4000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })
}

/* "playing\tSong\tArtist\thttps://i.scdn.co/…" → { playing, title, artist, art } */
function parseNowPlaying(text) {
  const [state, title, artist, art] = String(text).replace(/\n$/, '').split('\t')
  if (!title) return null
  return { playing: state === 'playing', title, artist: artist || '', art: /^https:\/\/i\.scdn\.co\//.test(art || '') ? art : '' }
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

  return { nowPlaying, control }
}

module.exports = { createMedia, parseNowPlaying }
