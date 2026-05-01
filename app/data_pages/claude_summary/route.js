export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You explain command-palette inputs for a stock-analytics terminal in ONE plain-English sentence (≤ 18 words).

Grammar (recognised verbs and shapes):
- <TICKER>                          → switch the active ticker
- <TICKER> GP <TF> [D=<n>]          → load chart, timeframe TF, n days history
- <TICKER> EARN | FIN | OPT | DES   → jump to earnings / financials / options / overview panel
- <TICKER> MC [TYPE] [K=…] [T=…D] [PATHS=…]  → Monte Carlo pricer
- MACRO YIELDS|COMM|FX|BANKS|CAL|FLIGHTS  → macro dashboards
- ADD <KIND> [SYM] [args]           → add a widget to the Custom workspace
- RM <slot> | CLEAR                 → remove a widget / clear workspace
- WATCH ADD <SYM> | WATCH RM <SYM>  → manage watchlist
- ALERT <SYM> PRICE|IV|MCPROB <op> <value>  → price/IV/MC alert
- ALERT <SYM> NEWS "<term>"         → news keyword alert
- SCREEN <predicate>                → run screener over the universe (e.g. P/E < 20 AND ROE > 0.15)
- SCREEN UNIVERSE SP500|CUSTOM      → switch screener universe

Reply with ONLY the sentence — no preamble, no quotes, no trailing punctuation beyond a period.`;

let client = null;
function getClient() {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  client = new Anthropic({ apiKey });
  return client;
}

export async function POST(req) {
  const c = getClient();
  if (!c) return new Response('', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

  let input = '';
  try { input = (await req.json())?.input || ''; } catch {}
  input = input.toString().slice(0, 200);
  if (!input.trim()) return new Response('', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

  try {
    const stream = c.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Command: ${input}` }],
    });

    const enc = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const ev of stream) {
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
              controller.enqueue(enc.encode(ev.delta.text || ''));
            }
          }
        } catch (_) {}
        controller.close();
      },
    });
    return new Response(readable, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (e) {
    return new Response('', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}