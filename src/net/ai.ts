/** The two AI paths My Routine offers.
 *
 *  1. A keyless hand-off: build a prompt from what's new, copy it, and open
 *     claude.ai with it prefilled. Nothing is stored, nothing is billed.
 *  2. An in-app digest through the user's own OpenRouter or Gemini key, kept
 *     in the settings table like every other preference. Calls go straight
 *     from the browser to the provider; there is no server in between. */

export type AiProvider = 'claude' | 'openrouter' | 'gemini';

export interface AiConfig {
  provider: AiProvider;
  openRouterKey: string;
  openRouterModel: string;
  geminiKey: string;
  geminiModel: string;
}

export const DEFAULT_AI: AiConfig = {
  provider: 'claude',
  openRouterKey: '',
  openRouterModel: 'deepseek/deepseek-r1-0528:free',
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash',
};

/** Free-tier models worth defaulting to; the field stays free-text so any
 *  model id can be pasted in. */
export const OPENROUTER_MODELS: Array<[id: string, label: string]> = [
  ['deepseek/deepseek-r1-0528:free', 'DeepSeek R1 (free)'],
  ['meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B (free)'],
  ['google/gemma-3-27b-it:free', 'Gemma 3 27B (free)'],
  ['qwen/qwen-2.5-72b-instruct:free', 'Qwen 2.5 72B (free)'],
];

export const GEMINI_MODELS: Array<[id: string, label: string]> = [
  ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
  ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Whether the in-app digest can run. The Claude hand-off needs no key, but it
 *  opens another app rather than answering in place, so it is not "ready" for
 *  a digest that renders inside the sheet. */
export function digestReady(config: AiConfig): boolean {
  if (config.provider === 'gemini') return !!config.geminiKey;
  if (config.provider === 'openrouter') return !!config.openRouterKey;
  return false;
}

export function providerLabel(config: AiConfig): string {
  if (config.provider === 'claude') return 'Claude app';
  if (config.provider === 'gemini') {
    return GEMINI_MODELS.find(([id]) => id === config.geminiModel)?.[1] ?? config.geminiModel;
  }
  return OPENROUTER_MODELS.find(([id]) => id === config.openRouterModel)?.[1] ?? config.openRouterModel;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function postWithRetry(
  url: string,
  init: RequestInit,
  onWait?: (msg: string) => void,
): Promise<Response> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, init);
    // Free tiers burst-limit easily; back off twice before giving up.
    if (res.status === 429 && attempt < 2) {
      const wait = (attempt + 1) * 6;
      onWait?.(`Rate limited — retrying in ${wait}s…`);
      await sleep(wait * 1000);
      continue;
    }
    return res;
  }
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    if (j?.error?.message) return String(j.error.message);
  } catch {
    /* body was not JSON */
  }
  return fallback;
}

async function openRouterChat(
  config: AiConfig,
  messages: ChatMessage[],
  maxTokens: number,
  onWait?: (msg: string) => void,
): Promise<string> {
  const res = await postWithRetry(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openRouterKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Clarity',
      },
      body: JSON.stringify({
        model: config.openRouterModel,
        messages,
        max_tokens: maxTokens,
        temperature: 0.4,
      }),
    },
    onWait,
  );

  if (!res.ok) {
    let msg = await errorMessage(res, `AI request failed (${res.status})`);
    if (res.status === 401) msg = 'Invalid OpenRouter key — check it in Settings → AI.';
    else if (res.status === 402) msg = 'Out of OpenRouter credits — switch to a :free model or top up.';
    else if (res.status === 429) {
      msg = 'OpenRouter rate limit. Free models allow roughly 20 requests a minute. Wait a moment, pick another :free model, or switch to Gemini in Settings → AI.';
    }
    throw new Error(msg);
  }

  const j = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning?: string } }>;
  };
  const m = j.choices?.[0]?.message;
  // Some reasoning models leave the answer in `reasoning` and send no content.
  let out = m?.content || m?.reasoning || '';
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!out) throw new Error('Empty AI response — try another model.');
  return out;
}

async function geminiChat(
  config: AiConfig,
  messages: ChatMessage[],
  maxTokens: number,
  onWait?: (msg: string) => void,
): Promise<string> {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const model = config.geminiModel || 'gemini-2.5-flash';
  const res = await postWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.geminiKey)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    onWait,
  );

  if (!res.ok) {
    let msg = await errorMessage(res, `Gemini request failed (${res.status})`);
    if (res.status === 400 && /api key/i.test(msg)) msg = 'Invalid Gemini key — check it in Settings → AI.';
    else if (res.status === 403) msg = `This Gemini key isn't allowed to use ${model}.`;
    else if (res.status === 429) msg = 'Gemini free-tier quota hit — wait a minute, or switch provider in Settings → AI.';
    throw new Error(msg);
  }

  const j = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  };
  const candidate = j.candidates?.[0];
  const out = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  if (!out) {
    if (candidate?.finishReason === 'SAFETY') throw new Error('Gemini blocked this request (safety filters).');
    throw new Error('Empty Gemini response — try again.');
  }
  return out;
}

/** One entry point for the in-app digest; routes to the configured provider. */
export function aiChat(
  config: AiConfig,
  messages: ChatMessage[],
  maxTokens = 1200,
  onWait?: (msg: string) => void,
): Promise<string> {
  if (config.provider === 'gemini') return geminiChat(config, messages, maxTokens, onWait);
  if (config.provider === 'openrouter') return openRouterChat(config, messages, maxTokens, onWait);
  return Promise.reject(new Error('Pick OpenRouter or Gemini in Settings → AI to summarize in place.'));
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API needs a secure context and a user gesture; fall back to
    // the old selection trick so the hand-off still works over plain http.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(ta);
    }
  }
}

/** Claude's web composer accepts a `q` param. We copy the full prompt too, so
 *  if it is too long to prefill the user can paste it in one tap. */
const CLAUDE_PREFILL_CAP = 1500;

export async function openInClaude(prompt: string): Promise<boolean> {
  const text = String(prompt ?? '').trim();
  if (!text) return false;
  await copyText(text);
  const capped =
    text.length > CLAUDE_PREFILL_CAP
      ? `${text.slice(0, CLAUDE_PREFILL_CAP)}\n\n[Full prompt copied to clipboard — paste to continue]`
      : text;
  window.open(`https://claude.ai/new?q=${encodeURIComponent(capped)}`, '_blank', 'noopener,noreferrer');
  return true;
}
