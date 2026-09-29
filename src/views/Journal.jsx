import { ArrowUpRight, BookOpenText, Check, MoonStars } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { localDateKey } from '../daily-practice.js';
import { dayNoteId, ensureDayNote, isActiveNote, isDayNote, updateNote, wordCount } from '../notes-model.js';
import { linkMentions } from '../nodes-model.js';
import { Markdown } from '../lib/markdown.jsx';
import { ReflectionView } from './Reflection.jsx';

/* One quiet question in the margin, a different one each day. */
const MARGIN = [
  ['What’s one thing you’d like to', 'make room for?'],
  ['What are you carrying that you could', 'set down?'],
  ['What surprised you', 'today?'],
  ['Who crossed your mind', 'today?'],
  ['What would make tomorrow', 'a little lighter?'],
  ['What did you notice that', 'nobody else did?'],
  ['What are you', 'looking forward to?'],
];

/* Today, the evening questions (Reflection's one home) and earlier pages. `target.tab` opens on one. */
export function JournalView({ workspace, commit, navigate, target }) {
  const today = localDateKey();
  const [tab, setTab] = useState(target?.tab || 'write');
  useEffect(() => { if (target?.tab) setTab(target.tab); }, [target?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState(null);
  const id = dayNoteId(today);
  const entry = workspace.notes.find((note) => note.id === id);
  const previous = workspace.notes.filter((note) => isActiveNote(note) && isDayNote(note) && note.id !== id && note.markdown.trim()).sort((a, b) => b.date.localeCompare(a.date));
  const chosen = previous.find((note) => note.id === selected);
  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${today}T12:00:00`));
  const [lead, turn] = MARGIN[Math.floor(Date.parse(`${today}T12:00:00Z`) / 86400000) % MARGIN.length];
  function write(markdown) {
    commit((state) => linkMentions(updateNote(ensureDayNote(state, today).state, id, { markdown }), id));
  }
  return <section className="journal-studio">
    <header className="journal-top">
      <div><p className="eyebrow">{dateLabel}</p><h1>Journal</h1></div>
      <nav className="journal-tabs" aria-label="Journal mode">{[['write', 'Today'], ['reflect', 'Evening'], ['past', 'Earlier']].map(([key, label]) => <button key={key} type="button" className={tab === key ? 'active' : ''} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</nav>
    </header>
    {tab === 'write' && <div className="journal-desk">
      <article className="journal-sheet">
        <header><span>{dateLabel}</span><span>{entry ? <><Check weight="bold" /> Kept on this Mac</> : 'A fresh page'}</span></header>
        <label htmlFor="journal-writing">How are you, really?</label>
        {entry && !isActiveNote(entry)
          ? <p className="quiet-empty">Today’s journal is in {entry.trashedAt ? 'Trash' : 'Archive'}. Restore it in Notes to continue writing.</p>
          : <textarea id="journal-writing" aria-label="Today's journal" value={entry?.markdown || ''} onChange={(event) => write(event.target.value)} placeholder="Start anywhere. What’s taking up space in your mind today?" spellCheck />}
        <footer>
          <span>{wordCount(entry?.markdown || '')} words · only for you</span>
          {entry && isActiveNote(entry) && <>
            <button type="button" onClick={() => navigate('Mindmap', { noteId: id })}><MoonStars /> See it in the Sky</button>
            <button type="button" onClick={() => navigate('Notes', { noteId: id })}>Open in Notes <ArrowUpRight /></button>
          </>}
        </footer>
      </article>
      <aside className="journal-margin">
        <span>If you need a place to start</span>
        <p>{lead} <em>{turn}</em></p>
        <small>This page is today’s note. Next steps you add today land here too, and it never leaves this Mac.</small>
      </aside>
    </div>}
    {tab === 'reflect' && <ReflectionView workspace={workspace} commit={commit} today={today} />}
    {tab === 'past' && <div className="journal-history"><aside>{previous.map((note) => <button key={note.id} className={selected === note.id ? 'active' : ''} onClick={() => setSelected(note.id)}><BookOpenText /><span>{note.title}<small>{note.date}</small></span></button>)}{!previous.length && <p>Your story starts here. Earlier pages will be waiting whenever you want to revisit them.</p>}</aside><article>{chosen ? <><p className="eyebrow">AN EARLIER PAGE · READ ONLY</p><h2>{chosen.title}</h2><Markdown text={chosen.markdown} /></> : <p className="quiet-empty">Choose a page to return to.</p>}</article></div>}
  </section>;
}
