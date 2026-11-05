import { createHash } from 'node:crypto';
import type { CaseInfo, Finding, GraphNode } from '../shared/types';
import { safeHttpUrl } from '../shared/normalize';
import { labelFor } from '../shared/normalize';
import type { Signer } from './signing';

export interface PackagePayload {
  v: 1; app: 'Plexus'; signedAt: string; redacted?: boolean;
  case: { name: string; purpose: string };
  integrity: { auditOk: boolean; auditEntries: number; evidenceChecked: number; evidenceAltered: number; auditHead?: string };
  entities: { type: string; label: string; score?: number; level?: number }[];
  findings: { id: string; type: string; label: string; relation: string; score: number; level: number; reasons: string[]; evidence: { adapterName: string; how?: string; url?: string; snippet?: string; verdict?: string; kind?: string; polarity?: string; record?: unknown; retrievedAt: number; hash?: string; adapter: string }[] }[];
}

/** The same canonical form the engine hashed when it recorded each observation (see server/integrity.ts). Reproduced in the page so it can re-check them. */
const CANON_SRC = `const canon = (e) => JSON.stringify([e.adapter, e.how ?? '', e.url ?? '', e.snippet ?? '', e.record ?? null, e.verdict ?? '', e.kind ?? 'direct', e.polarity ?? 'for', e.retrievedAt]);`;

export function buildPayload(c: CaseInfo, nodes: GraphNode[], accepted: Finding[], integrity: PackagePayload['integrity'], redact = false): PackagePayload {
  const mask = (s: string) => (redact ? s.replace(/[A-Za-z0-9]/g, '•') : s);
  return {
    v: 1, app: 'Plexus', signedAt: new Date().toISOString(), redacted: redact || undefined, case: { name: mask(c.name), purpose: mask(c.purpose) }, integrity,
    entities: nodes.filter((n) => n.state === 'confirmed' || n.state === 'seed').map((n) => ({ type: n.type, label: mask(n.label), score: n.score, level: n.level })),
    findings: accepted.map((f) => ({
      id: f.id, type: f.type, label: mask(labelFor(f.type, f.value, f.attrs)), relation: f.relation, score: f.score, level: f.level, reasons: f.reasons,
      evidence: f.evidence.map((e) => ({ adapter: e.adapter, adapterName: e.adapterName, how: redact ? undefined : e.how, url: redact ? undefined : safeHttpUrl(e.url), snippet: redact ? undefined : e.snippet, verdict: redact ? undefined : e.verdict, kind: e.kind, polarity: e.polarity, record: redact ? undefined : e.record, retrievedAt: e.retrievedAt, hash: e.hash })),
    })),
  };
}

const escJson = (s: string) => s.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * One self-contained HTML file: the evidence, a signature over it, and the code to check both in the recipient's own browser. Nothing is
 * fetched and nothing is sent anywhere. The page shows the evidence FROM the signed data, so what is on screen is what was signed.
 */
export function buildPackageHtml(payload: PackagePayload, signer: Signer, redacted = false): string {
  const payloadText = JSON.stringify(payload);
  const payloadSha = createHash('sha256').update(payloadText).digest('hex');
  const manifest = JSON.stringify({ v: 1, payloadSha256: payloadSha, signedAt: payload.signedAt, keyFingerprint: signer.fingerprint });
  const sig = { alg: 'Ed25519', publicKey: signer.publicKey, keyFingerprint: signer.fingerprint, manifest, signature: signer.sign(manifest) };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Evidence package · ${escJson(payload.case.name).replace(/\\u003c/g, '').slice(0, 80)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111;--mut:#666;--line:#e3e3e6;--soft:#f4f4f6;--ok:#1f8a5b;--bad:#d6453d;--warn:#b8801a}@media(prefers-color-scheme:dark){:root{--bg:#111;--fg:#f2f2f2;--mut:#9a9aa2;--line:#2a2a2e;--soft:#1b1b1e}}
body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;background:var(--bg);color:var(--fg);max-width:820px;margin:32px auto;padding:0 20px}
h1{font-size:26px;letter-spacing:-.03em;margin:0 0 4px}h2{font-size:17px;margin:30px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line)}.mut{color:var(--mut)}
.box{border:1px solid var(--line);border-radius:14px;padding:14px 16px;background:var(--soft);margin:16px 0}button{font:inherit;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}
.row{display:flex;gap:10px;align-items:baseline;margin:5px 0;flex-wrap:wrap}.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}code,.mono{font:12px ui-monospace,Menlo,monospace;word-break:break-all}
.f{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:10px 0}.ev{margin:8px 0 0;padding:8px 10px;border-radius:9px;background:var(--soft);font-size:13.5px}.ev b{font-weight:600}.q{border-left:3px solid var(--line);padding-left:9px;margin:4px 0}
table{border-collapse:collapse;font-size:12.5px;margin-top:4px}td,th{padding:2px 10px 2px 0;text-align:left;vertical-align:top}th{color:var(--mut);font-weight:500}a{color:#0a6cff;word-break:break-all}
@media print{button{display:none}}
</style></head><body>
<h1 id="title"></h1><div class="mut" id="sub"></div>
<div class="box" id="verify"><div class="row"><button id="vbtn">Verify this document</button><span class="mut">Checks run here, in your browser. Nothing is sent anywhere.</span></div><div id="vout"></div></div>
${redacted ? '<div class="box"><b>Redacted copy.</b> Names, quotes and links are masked; fingerprints and the signature still cover exactly what is shown.</div>' : ''}
<div id="doc"></div>
<h2>Verify it yourself, without this page</h2>
<p class="mut">The signature covers the manifest below. To check it with Node: take the text of the <code>plexus-payload</code> block, parse it as JSON and write it back out with <code>JSON.stringify</code> (this removes the escaping that makes it safe to embed), SHA-256 that, confirm it equals <code>payloadSha256</code>, then verify the Ed25519 signature of the manifest text with the public key. The key fingerprint should match what the sender tells you out loud or over another channel.</p>
<div class="row"><b>Key fingerprint</b><span class="mono" id="fp"></span></div>
<script type="application/json" id="plexus-payload">${escJson(payloadText)}</script>
<script type="application/json" id="plexus-signature">${escJson(JSON.stringify(sig))}</script>
<script>
(function(){
${CANON_SRC}
const $=(id)=>document.getElementById(id);
const P=JSON.parse($('plexus-payload').textContent), S=JSON.parse($('plexus-signature').textContent);
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e;};
const safeUrl=(u)=>{try{const x=new URL(u);return /^https?:$/.test(x.protocol)?x.href:null}catch{return null}};
const pct=(x)=>Math.round(x*100)+'%';
$('title').textContent=P.case.name||'Evidence package';
$('sub').textContent='Signed '+new Date(P.signedAt).toUTCString()+' · prepared with Plexus. Findings are leads, not proof.';
$('fp').textContent=S.keyFingerprint;
const doc=$('doc');
if(P.case.purpose){const p=el('p','mut','Purpose: '+P.case.purpose);doc.appendChild(p);}
const ig=P.integrity;doc.appendChild(el('h2',null,'Integrity when signed'));
const ul=el('p','mut',ig.evidenceChecked+' evidence fingerprints re-verified at signing ('+(ig.evidenceAltered?ig.evidenceAltered+' ALTERED':'none altered')+'); activity log of '+ig.auditEntries+' entries is '+(ig.auditOk?'an unbroken hash chain':'BROKEN')+'.');doc.appendChild(ul);
doc.appendChild(el('h2',null,'What was found ('+P.findings.length+' confirmed findings)'));
for(const f of P.findings){
  const box=el('div','f');const h=el('div','row');h.appendChild(el('b',null,f.label));h.appendChild(el('span','mut',f.type+' · '+f.relation.replace(/[-_]/g,' ')));h.appendChild(el('span',null,pct(f.score)+' confidence'));box.appendChild(h);
  for(const e of f.evidence){
    const v=el('div','ev');const t=el('div',null);t.appendChild(el('b',null,e.adapterName));if(e.kind==='cross')t.appendChild(el('span','mut',e.polarity==='against'?'  · cross-check contradicts':'  · cross-check confirms'));v.appendChild(t);
    if(e.how)v.appendChild(el('div','mut','Asked: '+e.how));
    if(e.snippet){const q=el('div','q',e.snippet);v.appendChild(q);}
    if(e.verdict)v.appendChild(el('div',null,e.verdict));
    if(e.record&&e.record.facts&&e.record.facts.length){const tb=el('table');for(const kv of e.record.facts){const tr=el('tr');tr.appendChild(el('th',null,kv[0]));tr.appendChild(el('td',null,kv[1]));tb.appendChild(tr);}v.appendChild(tb);}
    const u=e.url&&safeUrl(e.url);if(u){const a=el('a',null,u);a.href=u;a.rel='noreferrer noopener';a.target='_blank';const d=el('div','mut','Check: ');d.appendChild(a);v.appendChild(d);}
    const m=el('div','mut mono','Recorded '+new Date(e.retrievedAt).toISOString()+(e.hash?' · fingerprint '+e.hash.slice(0,16):''));v.appendChild(m);box.appendChild(v);
  }
  doc.appendChild(box);
}
const hex=(buf)=>[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
function sha256js(m){const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];let H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];const l=m.length,n=((l+9+63)>>6)<<6,b=new Uint8Array(n);b.set(m);b[l]=0x80;const dv=new DataView(b.buffer);dv.setUint32(n-4,(l*8)>>>0);dv.setUint32(n-8,Math.floor(l/0x20000000));const w=new Uint32Array(64);const r=(x,k)=>(x>>>k)|(x<<(32-k));for(let o=0;o<n;o+=64){for(let i=0;i<16;i++)w[i]=dv.getUint32(o+i*4);for(let i=16;i<64;i++){const a=r(w[i-15],7)^r(w[i-15],18)^(w[i-15]>>>3),c=r(w[i-2],17)^r(w[i-2],19)^(w[i-2]>>>10);w[i]=(w[i-16]+a+w[i-7]+c)>>>0;}let[a,c,d,e,f,g,h,j]=H;for(let i=0;i<64;i++){const S1=r(f,6)^r(f,11)^r(f,25),ch=(f&g)^(~f&h),t1=(j+S1+ch+K[i]+w[i])>>>0,S0=r(a,2)^r(a,13)^r(a,22),mj=(a&c)^(a&d)^(c&d),t2=(S0+mj)>>>0;j=h;h=g;g=f;f=(e+t1)>>>0;e=d;d=c;c=a;a=(t1+t2)>>>0;}H=[H[0]+a,H[1]+c,H[2]+d,H[3]+e,H[4]+f,H[5]+g,H[6]+h,H[7]+j].map(x=>x>>>0);}return H.map(x=>x.toString(16).padStart(8,'0')).join('');}
const sha=async(str)=>{const u=new TextEncoder().encode(str);return (window.crypto&&crypto.subtle)?hex(await crypto.subtle.digest('SHA-256',u)):sha256js(u);};
const b64=(s)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
$('vbtn').onclick=async()=>{
  const out=$('vout');out.textContent='';const line=(ok,text)=>{const r=el('div','row');r.appendChild(el('b',ok===true?'ok':ok===false?'bad':'warn',ok===true?'✓':ok===false?'✗':'!'));r.appendChild(el('span',null,text));out.appendChild(r);};
  try{
    const raw=$('plexus-payload').textContent;
    const shaV=await sha(JSON.stringify(JSON.parse(raw)));
    const man=JSON.parse(S.manifest);
    line(shaV===man.payloadSha256,shaV===man.payloadSha256?'The evidence has not been changed since it was signed.':'The evidence does NOT match what was signed.');
    let sigOk=null;
    try{if(!(window.crypto&&crypto.subtle))throw new Error('no subtle');const key=await crypto.subtle.importKey('raw',b64(S.publicKey),{name:'Ed25519'},false,['verify']);sigOk=await crypto.subtle.verify({name:'Ed25519'},key,b64(S.signature),new TextEncoder().encode(S.manifest));}catch(e){sigOk=null;}
    line(sigOk,sigOk===true?'The signature is valid for key '+S.keyFingerprint+'. Confirm that fingerprint with the sender.':sigOk===false?'The signature is NOT valid.':'This page cannot check Ed25519 signatures here (it needs a modern browser, with the file opened directly). The hashes still work; verify the signature with Node (see below).');
    let n=0,bad=0,un=0;
    if(P.redacted){line(null,'Redacted copy: the fingerprints are shown, but they cannot be recomputed because the original text is hidden. The signature still covers everything on this page.');}else{
    for(const f of P.findings)for(const e of f.evidence){if(!e.hash){un++;continue;}n++;const h=await sha(canon(e));if(h!==e.hash)bad++;}
    line(bad===0,bad===0?n+' of '+n+' evidence fingerprints match what was recorded.'+(un?' ('+un+' older items had no fingerprint.)':''):bad+' of '+n+' evidence items do not match their fingerprint.');}
    line(man.keyFingerprint===S.keyFingerprint,'The key named in the signature matches the key attached.');
  }catch(e){line(false,'Verification failed: '+e.message);}
};
})();
</script></body></html>`;
}
