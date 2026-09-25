import { useCallback, useEffect, useState } from 'react'
import { MusicNotes, Pause, Play, SkipBack, SkipForward } from '@phosphor-icons/react'

/* What Spotify is playing, with play/pause and skip. It only asks while the
   layer is showing, and never opens Spotify unless you press play. */
export function MediaWidget({ media, visit, move }) {
  const [track, setTrack] = useState(null)

  const refresh = useCallback(() => {
    if (document.visibilityState !== 'visible') return
    media.nowPlaying().then(setTrack).catch(() => {})
  }, [media])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 2500)
    return () => window.clearInterval(timer)
  }, [refresh, visit])

  function press(action) {
    if (action === 'toggle' && track) setTrack({ ...track, playing: !track.playing })
    media.media(action).catch(() => {}).finally(() => window.setTimeout(refresh, 400))
  }

  return (
    <section className="glass widget widget-media" aria-label="Spotify" {...move}>
      {track?.art ? <img src={track.art} alt="" /> : <span className="media-art" aria-hidden="true"><MusicNotes /></span>}
      <div className="media-text">
        <p className="widget-kicker">Spotify</p>
        <strong>{track?.title || 'Nothing playing'}</strong>
        {track?.artist && <span>{track.artist}</span>}
      </div>
      <div className="media-controls">
        <button type="button" aria-label="Previous track" disabled={!track} onClick={() => press('previous')}><SkipBack weight="fill" /></button>
        <button type="button" className="media-play" aria-label={track?.playing ? 'Pause' : 'Play'} onClick={() => press('toggle')}>
          {track?.playing ? <Pause weight="fill" /> : <Play weight="fill" />}
        </button>
        <button type="button" aria-label="Next track" disabled={!track} onClick={() => press('next')}><SkipForward weight="fill" /></button>
      </div>
    </section>
  )
}
