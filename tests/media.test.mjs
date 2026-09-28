import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const { createMedia, parseNowPlaying } = createRequire(import.meta.url)('../desktop/media.cjs')

test('what Spotify says is playing becomes a track, or nothing', () => {
  assert.deepEqual(parseNowPlaying('playing\tSong\tArtist\thttps://i.scdn.co/image/abc\t12.5\t215000\n'), { playing: true, title: 'Song', artist: 'Artist', art: 'https://i.scdn.co/image/abc', position: 12.5, duration: 215 })
  assert.equal(parseNowPlaying('paused\tSong\tArtist\thttps://evil.example/x').art, '')
  assert.equal(parseNowPlaying('paused\tSong\tA\t').playing, false)
  assert.equal(parseNowPlaying(''), null)
  // A Mac set to a decimal comma, and a Spotify that says nothing about time.
  assert.equal(parseNowPlaying('playing\tSong\tA\t\t61,25\t90000').position, 61.25)
  assert.deepEqual([parseNowPlaying('paused\tSong\tA\t').position, parseNowPlaying('paused\tSong\tA\t\tsoon\t-4').duration], [0, 0])
})

test('seeking goes only to a place inside the song that is playing', async () => {
  const scripts = []
  const media = createMedia({ run: async (script) => { scripts.push(script); return 'playing\tSong\tArtist\t\t10\t200000' }, fetch: () => assert.fail('no cover to fetch') })
  for (const bad of ['30', NaN, Infinity, -1, 200.5, null, undefined, { valueOf: () => 3 }]) {
    await assert.rejects(media.seek(bad), /isn’t a place/, String(bad))
  }
  assert.equal(scripts.some((script) => /player position to/.test(script)), false, 'nothing reached Spotify')
  assert.equal((await media.seek(61.456)).title, 'Song')
  assert.equal(scripts.filter((script) => /player position to/.test(script)).join(), 'tell application "Spotify" to set player position to 61.46')
  const quiet = createMedia({ run: async () => '' })
  await assert.rejects(quiet.seek(1), /isn’t a place/, 'nothing playing: nowhere to go')
})

test('only play/pause, next and previous reach Spotify', async () => {
  const scripts = []
  const media = createMedia({ run: async (script) => { scripts.push(script); return '' }, fetch: () => assert.fail('no cover to fetch') })
  assert.equal(await media.control('next'), null)
  assert.match(scripts[0], /to next track$/)
  await assert.rejects(media.control('quit'))
  assert.equal(scripts.length, 2)
})

test('a cover is fetched once and turned into a picture the page can show', async () => {
  let fetches = 0
  const media = createMedia({
    run: async () => 'playing\tSong\tArtist\thttps://i.scdn.co/image/abc',
    fetch: async () => { fetches += 1; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }) },
  })
  assert.equal((await media.nowPlaying()).art, 'data:image/jpeg;base64,AQID')
  await media.nowPlaying()
  assert.equal(fetches, 1)
})
