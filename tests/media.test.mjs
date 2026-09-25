import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const { createMedia, parseNowPlaying } = createRequire(import.meta.url)('../desktop/media.cjs')

test('what Spotify says is playing becomes a track, or nothing', () => {
  assert.deepEqual(parseNowPlaying('playing\tSong\tArtist\thttps://i.scdn.co/image/abc\n'), { playing: true, title: 'Song', artist: 'Artist', art: 'https://i.scdn.co/image/abc' })
  assert.equal(parseNowPlaying('paused\tSong\tArtist\thttps://evil.example/x').art, '')
  assert.equal(parseNowPlaying('paused\tSong\tA\t').playing, false)
  assert.equal(parseNowPlaying(''), null)
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
