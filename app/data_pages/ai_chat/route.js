export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM = `You are Quantum Terminal's AI Analyst — a senior equity research analyst writing comprehensive stock deep-dives for retail investors who want to understand a company thoroughly before making decisions.

When asked about a ticker or for a summary/analysis, produce a DENSE, STRUCTURED deep-dive covering ALL of the following sections. Do not skip sections. Be specific with numbers — actual revenue figures, EPS, margins, price targets, dates. Use Google Search grounding to get the most current data.

## BUSINESS OVERVIEW
What the company actually does, its core products/services, key revenue segments, and geographic exposure. Who are its customers and why do they pay?

## FINANCIAL SNAPSHOT
Latest reported revenue, YoY growth rate, gross margin, operating margin, net income/EPS. Free cash flow. Debt-to-equity, cash on hand. Any recent guidance raises or cuts.

## RECENT EARNINGS & CATALYST TIMELINE
Last earnings result: beat/miss vs. estimates, key management commentary. Next earnings date. Other upcoming catalysts: product launches, investor days, FDA decisions, contract announcements, etc.

## GROWTH DRIVERS
The 2–3 structural tailwinds powering the next 3–5 years of growth. Be specific — addressable market size, competitive advantages (moat), pricing power, unit economics.

## RISKS & BEAR CASE
The real risks: competition, margin compression, regulatory threats, customer concentration, macro sensitivity, balance sheet stress. What would make this investment thesis fail?

## VALUATION
Current P/E, forward P/E, P/S, EV/EBITDA. How does it compare to sector peers? Where do analyst consensus price targets sit — low/average/high? Is the stock cheap, fair, or stretched relative to growth?

## TECHNICAL PICTURE
Current price trend (uptrend/downtrend/range), key support and resistance levels, 50-day and 200-day moving average relationship, recent volume trends, any notable chart patterns.

## ANALYST SENTIMENT & OWNERSHIP
Wall Street consensus rating (strong buy / buy / hold / sell), number of analysts, recent rating changes. Institutional ownership %, notable funds adding or cutting. Short interest %.

## WHAT TO WATCH
The 3–4 specific things a retail investor should monitor over the next quarter — metrics, events, price levels, or macro factors — that will determine if the thesis plays out.

## BOTTOM LINE
One dense paragraph summarizing the complete picture: is this a compelling opportunity, a hold, or something to avoid, and why? Include the key risk/reward in plain English.

Style rules:
- Pack every section with specific numbers, dates, and named competitors/products
- Use Google Search grounding for current price, recent news, earnings data — cite sources as [1], [2] inline
- Write for someone who is smart but not a professional trader — explain jargon briefly
- No hedge-y filler phrases like "it's worth noting" or "investors should be aware"
- Format each section with a bold ## header so it's easy to scan
- Cite grounding sources inline as [1], [2], [3], [4], [5] where used`;


const MAX_CITATIONS = 5;
const CITATION_SENTINEL = '\n\n<<<CITATIONS>>>\n';

let genAI = null;
function getClient() {
  if (genAI) return genAI;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  genAI = new GoogleGenerativeAI(apiKey);
  return genAI;
}

export async function POST(req) {
  const client = getClient();
  if (!client) {
    return new Response('AI Analyst is not configured. Set GEMINI_API_KEY in env.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  let body = {};
  try { body = await req.json(); } catch {}
  const ticker = (body.ticker || 'NVDA').toString().toUpperCase().slice(0, 8);
  const input = (body.input || '').toString().slice(0, 2000);
  const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
  if (!input.trim()) {
    return new Response('', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const model = client.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM,
    tools: [{ googleSearch: {} }],
    generationConfig: { maxOutputTokens: 4000, temperature: 0.3 },
  });

  const contents = [
    ...history
      .filter((m) => m && m.content)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content).slice(0, 4000) }],
      })),
    { role: 'user', parts: [{ text: `Active ticker: ${ticker}\n\n${input}` }] },
  ];

  const enc = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        const result = await model.generateContentStream({ contents });

        for await (const chunk of result.stream) {
          let text = '';
          try { text = chunk.text() || ''; } catch { text = ''; }
          if (text) controller.enqueue(enc.encode(text));
        }

        try {
          const final = await result.response;
          const meta = final?.candidates?.[0]?.groundingMetadata;
          const chunks = meta?.groundingChunks || [];
          const seen = new Set();
          const cites = [];
          for (const c of chunks) {
            const uri = c?.web?.uri;
            const title = c?.web?.title || '';
            if (!uri || seen.has(uri)) continue;
            seen.add(uri);
            cites.push({ uri, title });
            if (cites.length >= MAX_CITATIONS) break;
          }
          if (cites.length) {
            controller.enqueue(enc.encode(CITATION_SENTINEL + JSON.stringify(cites)));
          }
        } catch {}
      } catch (e) {
        controller.enqueue(enc.encode(`\n\n[AI Analyst error: ${e?.message || 'unknown'}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}