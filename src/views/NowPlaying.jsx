import { useCallback, useEffect, useState } from 'react'
import { Check, MusicNotes, NotePencil, Pause, Play, SkipBack, SkipForward } from '@phosphor-icons/react'

import { localDateKey } from '../daily-practice.js'
import { appendToDay } from '../notes-model.js'

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

/* Now playing, bigger: the cover, a position bar to drag, previous / play / next, and a
   way to keep the song on today's page. It asks Spotify every second, only while the desk
   is showing. `media` is the Mac app's bridge (none in the browser preview). */
export function NowPlayingView({ commit, media }) {
  const [track, setTrack] = useState(null)
  const [scrub, setScrub] = useState(null)
  const [noted, setNoted] = useState('')

  const refresh = useCallback(() => {
    if (!media || document.visibilityState !== 'visible') return
    media.nowPlaying().then(setTrack).catch(() => {})
  }, [media])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 1000)
    return () => window.clearInterval(timer)
  }, [refresh])

  if (!media) return <p className="pop-gone">Spotify shows here in OSAT on your Mac.</p>

  function press(action) {
    if (action === 'toggle' && track) setTrack({ ...track, playing: !track.playing })
    media.media(action).catch(() => {}).finally(() => window.setTimeout(refresh, 400))
  }

  // The bar follows the song until it is held; letting go moves the song there.
  function seek() {
    if (scrub === null) return
    media.seek(scrub).then((next) => next && setTrack(next)).catch(() => {}).finally(() => setScrub(null))
  }

  const line = track ? `♪ ${track.title}${track.artist ? ` — ${track.artist}` : ''}` : ''
  const at = scrub ?? track?.position ?? 0
  return (
    <div className="now-playing">
      {track?.art ? <img className="now-cover" src={track.art} alt="" /> : <span className="now-cover" aria-hidden="true"><MusicNotes /></span>}
      <div className="now-title">
        <h2>{track?.title || 'Nothing playing'}</h2>
        {track?.artist && <p>{track.artist}</p>}
      </div>
      <label className="now-seek">
        <span className="visually-hidden">Position in the song</span>
        <input
          type="range"
          min="0"
          max={Math.max(1, Math.round(track?.duration || 0))}
          step="1"
          value={Math.round(at)}
          disabled={!track?.duration}
          aria-valuetext={track ? `${clock(at)} of ${clock(track.duration)}` : undefined}
          onChange={(event) => setScrub(Number(event.target.value))}
          onPointerUp={seek}
          onKeyUp={seek}
        />
        <span className="now-times" aria-hidden="true"><span>{clock(at)}</span><span>{clock(track?.duration || 0)}</span></span>
      </label>
      <div className="now-controls">
        <button type="button" aria-label="Previous track" disabled={!track} onClick={() => press('previous')}><SkipBack weight="fill" /></button>
        <button type="button" className="now-play" aria-label={track?.playing ? 'Pause' : 'Play'} onClick={() => press('toggle')}>
          {track?.playing ? <Pause weight="fill" /> : <Play weight="fill" />}
        </button>
        <button type="button" aria-label="Next track" disabled={!track} onClick={() => press('next')}><SkipForward weight="fill" /></button>
      </div>
      {track && (
        noted === line
          ? <p className="now-note is-done"><Check weight="bold" /> On today’s page</p>
          : <button type="button" className="now-note" onClick={() => { commit((state) => appendToDay(state, localDateKey(), line)); setNoted(line) }}><NotePencil /> Note it on today’s page</button>
      )}
    </div>
  )
}
