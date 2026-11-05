import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-aip-'));
const { Store } = await import('../server/store');
const { writeSecret } = await import('../server/config');
const ai = await import('../server/ai');

const OR_MODELS = { data: [
  { id: 'openrouter/auto', name: 'Auto Router', context_length: 2000000, pricing: { prompt: '-1', completion: '-1' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B', context_length: 131072, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini Flash', context_length: 1048576, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
  { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1', context_length: 163840, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'tiny/model:free', name: 'Tiny', context_length: 2048, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'some/embedder:free', name: 'Embedder', context_length: 8192, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['embeddings'] } },
] };
const G_MODELS = { object: 'list', data: ['models/gemini-2.5-pro', 'models/gemini-2.5-flash', 'models/gemini-2.5-flash-lite', 'models/gemini-2.0-flash', 'models/gemini-1.5-flash', 'models/embedding-001'].map((id) => ({ id, object: 'model', owned_by: 'google' })) };
const OK = (text = 'ok', model?: string) => new Response(JSON.stringify({ model, choices: [{ message: { content: text } }] }));

type Call = { url: string; body?: any; headers: Record<string, string> };
function net(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: any = {}) => { const c: Call = { url, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers ?? {} }; calls.push(c); return handler(c); }) as unknown as typeof fetch;
  return { f, calls, chats: () => calls.filter((c) => c.url.endsWith('/chat/completions')) };
}
const mk = (provider: string, extra: object = {}) => {
  const s = new Store(join(mkdtempSync(join(tmpdir(), 'plexus-aip1-')), 'p.db'));
  s.setSetting('ai', { provider, allowCloud: true, ...extra });
  writeSecret('ai', 'KEY-123');
  ai.resetAiCache();
  return s;
};
const msg = [{ role: 'user' as const, content: 'hi' }];
beforeEach(() => ai.resetAiCache());

describe('OpenRouter with no credits', () => {
  it('automatic mode uses only free models, best first, and skips tiny or non-text ones', async () => {
    const s = mk('openrouter');
    const n = net(() => new Response(JSON.stringify(OR_MODELS)));
    const chain = await ai.autoCandidates(s, { fetchImpl: n.f });
    expect(chain[0]).toBe('meta-llama/llama-3.3-70b-instruct:free');
    expect(chain).toContain('google/gemini-2.0-flash-exp:free');
    expect(chain.every((id) => id.endsWith(':free'))).toBe(true);
    expect(chain).not.toContain('openrouter/auto'); expect(chain).not.toContain('anthropic/claude-sonnet-4');
    expect(chain).not.toContain('tiny/model:free');               // 2k context is too small to be useful
    expect(chain.indexOf('deepseek/deepseek-r1:free')).toBeGreaterThan(chain.indexOf('google/gemini-2.0-flash-exp:free'));   // reasoning models are slower: last
  });
  it('for pictures, only free models that can see', async () => {
    const chain = await ai.autoCandidates(mk('openrouter'), { vision: true, fetchImpl: net(() => new Response(JSON.stringify(OR_MODELS))).f });
    expect(chain).toEqual(['google/gemini-2.0-flash-exp:free']);
  });
  it('actually asks a free model, never the paid auto-router, and sends the key', async () => {
    const s = mk('openrouter');
    const n = net((c) => (c.url.endsWith('/models') ? new Response(JSON.stringify(OR_MODELS)) : OK('ok', c.body.model)));
    const r = await ai.complete(s, msg, { fetchImpl: n.f });
    expect(r.model).toBe('meta-llama/llama-3.3-70b-instruct:free');
    expect(n.chats()[0].body.model).toBe('meta-llama/llama-3.3-70b-instruct:free');
    expect(n.chats()[0].headers.Authorization).toBe('Bearer KEY-123'); expect(n.chats()[0].headers['HTTP-Referer']).toBeTruthy();
  });
  it('falls through rate-limited and missing free models to one that answers, and remembers it', async () => {
    const s = mk('openrouter');
    const n = net((c) => {
      if (c.url.endsWith('/models')) return new Response(JSON.stringify(OR_MODELS));
      if (c.body.model.startsWith('meta-llama')) return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded: free-models-per-day', code: 429 } }), { status: 429 });
      if (c.body.model.startsWith('google/')) return new Response(JSON.stringify({ error: { message: 'No endpoints found for google/gemini-2.0-flash-exp:free.', code: 404 } }), { status: 404 });
      return OK('ok', c.body.model);
    });
    const r = await ai.complete(s, msg, { fetchImpl: n.f });
    expect(r.model).toBe('deepseek/deepseek-r1:free');
    const again = net((c) => (c.url.endsWith('/models') ? new Response(JSON.stringify(OR_MODELS)) : OK('ok', c.body.model)));
    await ai.complete(s, msg, { fetchImpl: again.f });
    expect(again.chats()[0].body.model).toBe('deepseek/deepseek-r1:free');       // tries the one that worked last time first
  });
  it('works from a built-in list of free models when the list cannot be downloaded', async () => {
    const s = mk('openrouter');
    const n = net((c) => (c.url.endsWith('/models') ? new Response('', { status: 500 }) : OK('ok', c.body.model)));
    expect((await ai.complete(s, msg, { fetchImpl: n.f })).model).toMatch(/:free$/);
  });
  it('when everything is exhausted, says why in plain words instead of "does not work"', async () => {
    const s = mk('openrouter');
    const n = net((c) => (c.url.endsWith('/models') ? new Response(JSON.stringify(OR_MODELS)) : new Response(JSON.stringify({ error: { message: 'Rate limit exceeded: free-models-per-day', code: 429 } }), { status: 429 })));
    const e: any = await ai.complete(s, msg, { fetchImpl: n.f }).catch((x) => x);
    expect(e).toBeInstanceOf(ai.AiError); expect(e.kind).toBe('quota');
    expect(e.userMessage).toMatch(/rate-limited or over its free allowance|free daily allowance/); expect(e.attempts.length).toBeGreaterThan(1);
    expect(e.userMessage.length).toBeLessThan(400);
  });
  it('a paid model picked by hand that needs credits fails clearly and is not silently swapped', async () => {
    const s = mk('openrouter', { model: 'anthropic/claude-sonnet-4' });
    const n = net(() => new Response(JSON.stringify({ error: { message: 'Insufficient credits. Add more using https://openrouter.ai/credits', code: 402 } }), { status: 402 }));
    const e: any = await ai.complete(s, msg, { fetchImpl: n.f }).catch((x) => x);
    expect(e.kind).toBe('credits'); expect(e.userMessage).toMatch(/needs credits/); expect(e.userMessage).toMatch(/:free/); expect(n.chats()).toHaveLength(1);
  });
  it('a rejected key stops at once and says where to get a new one', async () => {
    const s = mk('openrouter');
    const n = net((c) => (c.url.endsWith('/models') ? new Response(JSON.stringify(OR_MODELS)) : new Response(JSON.stringify({ error: { message: 'No auth credentials found', code: 401 } }), { status: 401 })));
    const e: any = await ai.complete(s, msg, { fetchImpl: n.f }).catch((x) => x);
    expect(e.kind).toBe('key'); expect(e.userMessage).toMatch(/openrouter\.ai\/keys/); expect(n.chats()).toHaveLength(1);
  });
  it('lists models with free and picture-capable flags for the picker', async () => {
    const m = await ai.listModels(mk('openrouter'), net(() => new Response(JSON.stringify(OR_MODELS))).f);
    expect(m.find((x) => x.id === 'openrouter/auto')!.free).toBe(false);
    expect(m.find((x) => x.id === 'meta-llama/llama-3.3-70b-instruct:free')).toMatchObject({ free: true, vision: false });
    expect(m.find((x) => x.id === 'google/gemini-2.0-flash-exp:free')).toMatchObject({ free: true, vision: true });
    expect(m.find((x) => x.id === 'anthropic/claude-sonnet-4')!.promptPrice).toBeCloseTo(3, 5);
  });
});

describe('Google AI Studio', () => {
  it('automatic mode uses Flash models the free plan includes, never Pro, never embeddings', async () => {
    const chain = await ai.autoCandidates(mk('google'), { fetchImpl: net(() => new Response(JSON.stringify(G_MODELS))).f });
    expect(chain[0]).toBe('gemini-2.5-flash');
    expect(chain).toEqual(expect.arrayContaining(['gemini-2.5-flash-lite', 'gemini-2.0-flash']));
    expect(chain.some((id) => /pro|embedding/.test(id))).toBe(false);
  });
  it('uses the OpenAI-compatible endpoint with a Bearer key and strips the models/ prefix', async () => {
    const s = mk('google'); const n = net((c) => (c.url.endsWith('/models') ? new Response(JSON.stringify(G_MODELS)) : OK('ok', c.body.model)));
    await ai.complete(s, msg, { fetchImpl: n.f });
    expect(n.chats()[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(n.chats()[0].headers.Authorization).toBe('Bearer KEY-123'); expect(n.chats()[0].body.model).toBe('gemini-2.5-flash');
  });
  it('when a model is not on the free plan (429 "limit: 0"), moves to the next Flash model', async () => {
    const s = mk('google');
    const n = net((c) => {
      if (c.url.endsWith('/models')) return new Response(JSON.stringify(G_MODELS));
      if (c.body.model === 'gemini-2.5-flash') return new Response(JSON.stringify([{ error: { code: 429, message: 'You exceeded your current quota. * Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-2.5-flash', status: 'RESOURCE_EXHAUSTED' } }]), { status: 429 });
      return OK('ok', c.body.model);
    });
    expect((await ai.complete(s, msg, { fetchImpl: n.f })).model).toBe('gemini-2.5-flash-lite');
  });
  it('reads Google\'s array-shaped errors: a bad key gets a useful message with where to get one', async () => {
    const s = mk('google');
    const n = net((c) => (c.url.endsWith('/models') ? new Response(JSON.stringify(G_MODELS)) : new Response(JSON.stringify([{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }]), { status: 400 })));
    const e: any = await ai.complete(s, msg, { fetchImpl: n.f }).catch((x) => x);
    expect(e.kind).toBe('key'); expect(e.userMessage).toMatch(/aistudio\.google\.com\/apikey/); expect(e.userMessage).toMatch(/AIza/);
  });
  it('explains an unsupported region and a restricted key', () => {
    expect(ai.explain('google', 400, JSON.stringify([{ error: { message: 'User location is not supported for the API use.', status: 'FAILED_PRECONDITION' } }])).kind).toBe('region');
    expect(ai.explain('google', 403, JSON.stringify({ error: { message: 'Generative Language API has not been used in project' } })).message).toMatch(/Create a fresh key/);
  });
  it('an explicitly chosen Pro model that has no free quota fails with the real reason', async () => {
    const s = mk('google', { model: 'gemini-2.5-pro' });
    const n = net(() => new Response(JSON.stringify({ error: { message: 'quota limit: 0 free_tier', code: 429 } }), { status: 429 }));
    const e: any = await ai.complete(s, msg, { fetchImpl: n.f }).catch((x) => x);
    expect(e.kind).toBe('quota'); expect(e.userMessage).toMatch(/free plan does not include/); expect(n.chats()).toHaveLength(1);
  });
  it('picture requests use a model that can see (Flash does)', async () => {
    const s = mk('google'); const n = net((c) => (c.url.endsWith('/models') ? new Response(JSON.stringify(G_MODELS)) : OK('ok', c.body.model)));
    expect((await ai.complete(s, msg, { fetchImpl: n.f, vision: true })).model).toBe('gemini-2.5-flash');
  });
});

describe('every provider', () => {
  it('an empty answer, a timeout or a server error moves on to the next model', async () => {
    const s = mk('google'); let i = 0;
    const n = net((c) => {
      if (c.url.endsWith('/models')) return new Response(JSON.stringify(G_MODELS));
      i++; if (i === 1) return new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }));
      if (i === 2) throw new Error('The operation timed out');
      if (i === 3) return new Response('upstream error', { status: 503 });
      return OK('finally', c.body.model);
    });
    expect((await ai.complete(s, msg, { fetchImpl: n.f })).text).toBe('finally');
  });
  it('explains network failures and unknown errors without raw JSON', () => {
    expect(ai.explain('openai', undefined, 'fetch failed').message).toMatch(/Could not reach OpenAI/);
    expect(ai.explain('openai', 418, '{"error":{"message":"I am a teapot"}}').message).toMatch(/teapot/);
    expect(ai.explain('openrouter', 402, '{"error":{"message":"Insufficient credits"}}').kind).toBe('credits');
    expect(ai.explain('openai', 401, '{"error":{"message":"Incorrect API key provided: sk-abc"}}').kind).toBe('key');
    expect(ai.explain('openai', 500, 'x').message).toMatch(/problem on its side/);
  });
  it('Ollama: picks an installed model, and an installed picture model for pictures; says so when none can see', async () => {
    const s = mk('ollama'); const models = { data: [{ id: 'llama3.2:3b' }, { id: 'llava:13b' }, { id: 'nomic-embed-text' }] };
    expect(await ai.autoCandidates(s, { fetchImpl: net(() => new Response(JSON.stringify(models))).f })).toEqual(['llama3.2:3b', 'llava:13b']);
    expect(await ai.autoCandidates(s, { vision: true, fetchImpl: net(() => new Response(JSON.stringify(models))).f })).toEqual(['llava:13b']);
    ai.resetAiCache();
    const e: any = await ai.complete(s, msg, { vision: true, fetchImpl: net(() => new Response(JSON.stringify({ data: [{ id: 'llama3.2:3b' }] }))).f }).catch((x) => x);
    expect(e.userMessage).toMatch(/ollama pull llava/);
  });
  it('OpenAI automatic mode starts with a small current model', async () => {
    expect((await ai.autoCandidates(mk('openai')))[0]).toBe('gpt-4.1-mini');
  });
  it('explicit model and vision model are honoured', async () => {
    const s = mk('custom', { baseUrl: 'https://llm.example/v1', model: 'text-model', visionModel: 'eyes-model' });
    const n = net((c) => OK('ok', c.body.model));
    await ai.complete(s, msg, { fetchImpl: n.f }); await ai.complete(s, msg, { fetchImpl: n.f, vision: true });
    expect(n.chats().map((c) => c.body.model)).toEqual(['text-model', 'eyes-model']);
  });
  it('is not ready without a key, in local-only mode, or when off, with a message that says what to do', async () => {
    const s = new Store(join(mkdtempSync(join(tmpdir(), 'plexus-aip2-')), 'p.db'));
    const e: any = await ai.complete(s, msg).catch((x) => x); expect(e.userMessage).toMatch(/Choose a provider/);
  });
});
