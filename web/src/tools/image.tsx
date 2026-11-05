import { useEffect, useRef, useState } from 'react';
import { ela, compareImages, type ElaResult, type ImageCompare } from '@shared/tools/pixels';
import { parseScreenshotReply } from '@shared/tools/screenshot';
import type { ScreenReading } from '@shared/tools/screenshot';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import type { EntityType } from '@shared/types';
import { Notice, Card, Facts, DropFile, loadImage, pixelsOf, canvasBlob, fileUrl, usePasteImage, useAdd, useBusy, AddBtn } from './kit';

const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function Ela() {
  const [res, setRes] = useState<{ r: ElaResult; url: string; name: string } | null>(null);
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null), ov = useRef<HTMLCanvasElement>(null);
  const take = async (f: File) => {
    setBusy(true); setErr(''); setRes(null);
    try {
      const url = fileUrl(f), img = await loadImage(url);
      const w = img.naturalWidth, h = img.naturalHeight;
      if (w * h > 36_000_000) throw new Error('That picture is very large (over 36 megapixels). Crop or scale it first.');
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d')!.drawImage(img, 0, 0);
      // save it again at a fixed quality and see what changes
      const again = await loadImage(fileUrl(await canvasBlob(c, 'image/jpeg', 0.9)));
      const r = ela(pixelsOf(img, w, h), pixelsOf(again, w, h), 20);
      setRes({ r, url, name: f.name });
    } catch (e: any) { setErr(e?.message ?? 'Could not analyse that picture'); } finally { setBusy(false); }
  };
  usePasteImage(take);
  useEffect(() => {
    if (!res || !cv.current || !ov.current) return;
    const { r } = res; cv.current.width = r.width; cv.current.height = r.height;
    cv.current.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.image), r.width, r.height), 0, 0);
    ov.current.width = r.width; ov.current.height = r.height; const g = ov.current.getContext('2d')!; g.clearRect(0, 0, r.width, r.height); g.strokeStyle = '#ff3b30'; g.lineWidth = Math.max(2, r.width / 400);
    for (const b of r.blocks) g.strokeRect(b.x, b.y, b.w, b.h);
  }, [res]);
  return (
    <div className="tl-stack">
      <Notice>Error Level Analysis: Plexus saves the picture again at a known quality and shows how much each region changes. Parts pasted in or edited and re-saved often change by a different amount from the rest. It is a hint, not proof: sharp edges, text and noise also light up. Works on JPEG photos; screenshots and PNGs will look uniform.</Notice>
      <DropFile label="Choose a picture…" onFile={take} />
      {busy && <p className="faint">Analysing…</p>}{err && <Notice level="warning">{err}</Notice>}
      {res && <Card title={{ uniform: 'Even throughout', uneven: 'Some regions behave differently', inconclusive: 'Inconclusive' }[res.r.verdict]} sub={res.name}>
        <Notice level={res.r.verdict === 'uneven' ? 'warning' : 'info'}>{res.r.note}</Notice>
        <div className="tl-pair"><figure><img src={res.url} alt="Original" /><figcaption>Original</figcaption></figure><figure className="tl-stackimg"><canvas ref={cv} /><canvas ref={ov} className="tl-overlay" /><figcaption>Error levels (bright = changed more). Red boxes mark the most different regions.</figcaption></figure></div>
        <Facts rows={[['Average change', res.r.mean.toFixed(2)], ['Largest change', res.r.max.toFixed(0)], ['Odd regions', String(res.r.blocks.length)]]} />
      </Card>}
    </div>
  );
}

export function ImageCompareTool() {
  const [files, setFiles] = useState<{ url: string; name: string; px: ReturnType<typeof pixelsOf> }[]>([]);
  const [r, setR] = useState<ImageCompare | null>(null), [err, setErr] = useState('');
  const take = async (f: File) => {
    try {
      const url = fileUrl(f), img = await loadImage(url);
      const k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
      const px = pixelsOf(img, Math.max(8, Math.round(img.naturalWidth * k)), Math.max(8, Math.round(img.naturalHeight * k)));
      setFiles((x) => [...x.slice(-1), { url, name: f.name, px }]); setErr('');
    } catch (e: any) { setErr(e?.message ?? 'Could not read that picture'); }
  };
  usePasteImage(take);
  useEffect(() => { setR(files.length === 2 ? compareImages(files[0].px, files[1].px) : null); }, [files]);
  return (
    <div className="tl-stack">
      <Notice>Are these two pictures the same? Plexus makes a small visual fingerprint of each (ignoring size, format and light editing) and compares them, including a left-right mirror. Use it to spot a reposted, cropped or flipped copy of a profile picture or a photo.</Notice>
      <DropFile label="Add a picture…" multiple onFile={take} />
      {err && <Notice level="warning">{err}</Notice>}
      <div className="tl-pair">{files.map((f, i) => <figure key={f.url}><img src={f.url} alt={`Picture ${i + 1}`} /><figcaption>{f.name}</figcaption></figure>)}</div>
      {files.length === 1 && <p className="faint">Add a second picture to compare. You can also paste from the clipboard.</p>}
      {r && <Card title={{ identical: 'Identical', 'same-picture': 'The same picture', 'look-alike': 'Look-alikes', different: 'Different pictures' }[r.verdict]} sub={r.note}>
        <Facts rows={[['Fingerprint A', r.hashA], ['Fingerprint B', r.hashB], ['Bits that differ', `${r.hamming} of 64`], ['Colour difference', `${(r.colorDiff * 100).toFixed(1)}%`], ['Mirrored', r.mirrored ? 'Yes, one is flipped left-to-right' : 'No']]} />
      </Card>}
    </div>
  );
}

export function Screenshot() {
  const s = useStore(), add = useAdd();
  const [thumb, setThumb] = useState('');
  const { busy, err, data, run } = useBusy<ScreenReading>();
  const take = async (f: File) => {
    const url = fileUrl(f); setThumb(url);
    await run(async () => {
      const img = await loadImage(url), k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      const image = c.toDataURL('image/jpeg', 0.85);
      const send = (confirmed: boolean) => api.post<{ reading: unknown }>('/api/tools/read-image', { image, confirmed });
      let r: { reading: unknown };
      try { r = await send(false); } catch (e: any) {
        if (!/confirm_required/.test(e?.message ?? '')) throw e;
        if (!window.confirm('This sends the picture to your AI provider so it can read the text. Continue?')) throw new Error('Cancelled. Nothing was sent.');
        r = await send(true);
      }
      const reading = parseScreenshotReply(r.reading); if (!reading) throw new Error('Could not understand the answer.');
      return reading;
    });
  };
  usePasteImage(take);
  const addAll = async () => { let n = 0; for (const i of (data?.items ?? []).filter((x) => x.valid && x.entity && x.type !== 'name')) { if (await add(i.entity!.type, i.entity!.value)) n++; } if (n) s.toast(`Added ${n} items`); };
  return (
    <div className="tl-stack">
      <Notice>Drop a screenshot of a profile, a chat, a post or a settings page. The AI reads what is written on it (handles, emails, phone numbers, links, dates, display names) and Plexus checks each item before offering it. Faces are ignored. Needs a vision-capable AI model in Settings; paste a screenshot straight from the clipboard.</Notice>
      <DropFile label="Choose a screenshot…" onFile={take} />
      {busy && <p className="faint">Reading the screenshot…</p>}{err && <Notice level="warning">{err}</Notice>}
      {data && <div className="tl-split">
        {thumb && <img className="tl-thumb" src={thumb} alt="Screenshot" />}
        <Card title={data.platform ? `${data.platform} · ${data.kind}` : data.kind} sub={data.summary} right={<button className="btn primary sm" onClick={addAll}>Add all valid</button>}>
          {data.items.length === 0 && <p className="faint">Nothing readable was found.</p>}
          <ul className="tl-pick">{data.items.map((i, k) => <li key={k}><span className="tl-chip">{i.type}</span> <span className="tl-val" data-invalid={!i.valid}>{i.value}</span>{i.context && <span className="faint"> · {i.context}</span>}{!i.valid && <span className="faint"> · did not validate</span>}{i.entity && i.valid && <AddBtn type={i.entity.type as EntityType} value={i.entity.value} label="Add" />}</li>)}</ul>
        </Card>
      </div>}
    </div>
  );
}

const hasExif = async (f: File) => { const b = new Uint8Array(await f.slice(0, 131072).arrayBuffer()); for (let i = 0; i < b.length - 6; i++) if (b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 && b[i + 3] === 0x66 && b[i + 4] === 0 && b[i + 5] === 0) return true; return false; };
export function Strip() {
  const [out, setOut] = useState<{ blob: Blob; name: string; before: number; exif: boolean; url: string } | null>(null), [err, setErr] = useState('');
  const take = async (f: File) => {
    setErr(''); setOut(null);
    try {
      const url = fileUrl(f), img = await loadImage(url);
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d')!.drawImage(img, 0, 0);
      const png = f.type === 'image/png', blob = await canvasBlob(c, png ? 'image/png' : 'image/jpeg', 0.92);
      setOut({ blob, name: f.name.replace(/\.[^.]+$/, '') + '-clean.' + (png ? 'png' : 'jpg'), before: f.size, exif: await hasExif(f), url: fileUrl(blob) });
    } catch (e: any) { setErr(e?.message ?? 'Could not clean that picture'); }
  };
  return (
    <div className="tl-stack">
      <Notice>Before you share a picture, remove what it carries: camera model, date and time, GPS location, editing software, thumbnails. Plexus redraws the pixels into a new file, which drops all of it. Nothing leaves your computer.</Notice>
      <DropFile label="Choose a picture…" onFile={take} accept="image/jpeg,image/png,image/webp" />
      {err && <Notice level="warning">{err}</Notice>}
      {out && <Card title="Clean copy ready" sub={out.exif ? 'The original carried EXIF metadata (camera, time, possibly GPS). The copy has none.' : 'The original had no EXIF block in its first 128 KB. The copy is clean regardless.'}>
        <Facts rows={[['Original', kb(out.before)], ['Clean copy', kb(out.blob.size)]]} />
        <div className="tl-actions"><a className="btn primary" href={out.url} download={out.name}>Save {out.name}</a></div>
      </Card>}
    </div>
  );
}
