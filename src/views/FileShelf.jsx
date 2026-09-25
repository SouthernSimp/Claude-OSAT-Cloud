import { ArrowDown, FileText, FolderOpen, LockKey, Plus, Trash, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { listShelfFiles, removeShelfFile, saveShelfFile } from '../lib/file-store.js';
import { formatBytes } from '../lib/ui.js';

export function FileShelf() {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [query, setQuery] = useState('');
  const picker = useRef(null);
  useEffect(() => { listShelfFiles().then(setFiles).catch((reason) => setError(reason.message)); }, []);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);
  async function add(chosen) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      for (const file of chosen) {
        const record = await saveShelfFile(file);
        setFiles((current) => [record, ...current]);
      }
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); if (picker.current) picker.current.value = ''; }
  }
  async function open(file) {
    if (/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type)) setPreview({ file, url: URL.createObjectURL(file.blob) });
    else if (/\.(txt|md|csv|json|log)$/i.test(file.name) || file.type.startsWith('text/')) setPreview({ file, text: (await file.blob.text()).slice(0, 100000) });
    else setPreview({ file });
  }
  function download(file) { const url = URL.createObjectURL(file.blob); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function remove(file) {
    if (!window.confirm(`Remove the browser copy of “${file.name}”? The original file on your Mac stays unchanged.`)) return;
    try { await removeShelfFile(file.id); setFiles((current) => current.filter((item) => item.id !== file.id)); if (preview?.file.id === file.id) setPreview(null); }
    catch (reason) { setError(reason.message); }
  }
  const visible = files.filter((file) => file.name.toLowerCase().includes(query.toLowerCase())).sort((a,b) => b.addedAt.localeCompare(a.addedAt));
  return <section className="file-shelf">
    <header className="shelf-heading"><div><p className="eyebrow">KEEP WHAT MATTERS CLOSE</p><h1>A shelf for your world.</h1><p>Documents, inspiration, the things you’ll want to find again.</p></div><button className="primary-button" onClick={() => picker.current.click()} disabled={busy}><Plus />{busy ? 'Keeping your files…' : 'Add files'}</button></header>
    <input ref={picker} type="file" multiple hidden onChange={(event) => add([...event.target.files])} />
    <div className="shelf-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); add([...event.dataTransfer.files]); }}><FolderOpen weight="duotone" /><div><strong>Drop something worth keeping.</strong><p>Or <button onClick={() => picker.current.click()} disabled={busy}>choose a file</button>. Copies stay in this browser · up to 25 MB each.</p></div><LockKey /></div>
    <div className="shelf-toolbar"><span>{files.length} files · {formatBytes(files.reduce((total, file) => total + file.size, 0))}</span><input aria-label="Find a file" placeholder="Find a file…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="shelf-layout"><div className="shelf-files">{visible.map((file) => <article key={file.id} className={preview?.file.id === file.id ? 'selected' : ''}><button onClick={() => open(file)}><FileText weight="duotone" /><strong>{file.name}</strong><small>{formatBytes(file.size)} · {file.addedAt.slice(0,10)}</small></button><div><button aria-label={`Download ${file.name}`} onClick={() => download(file)}><ArrowDown /></button><button aria-label={`Remove ${file.name}`} onClick={() => remove(file)}><Trash /></button></div></article>)}{!visible.length && <p className="quiet-empty">{query ? 'Nothing by that name yet.' : 'Your shelf is ready for its first file.'}</p>}</div>{preview && <aside className="shelf-preview"><header><strong>{preview.file.name}</strong><button onClick={() => setPreview(null)} aria-label="Close file preview"><X /></button></header>{preview.url ? <img src={preview.url} alt={preview.file.name} /> : preview.text !== undefined ? <pre>{preview.text}</pre> : <div className="gentle-empty"><FileText /><p>This file is safely stored. Download a copy to open it in its usual app.</p></div>}<button className="outline-button" onClick={() => download(preview.file)}><ArrowDown />Download a copy</button></aside>}</div>
    <p className="shelf-note"><LockKey /> Browser copies are kept on this device. Export important originals separately; workspace backups don’t include this shelf.</p>
  </section>;
}
