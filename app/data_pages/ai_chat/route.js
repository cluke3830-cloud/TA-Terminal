export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM = `You are Quantum Terminal's AI Analyst. The active ticker is provided with each message.

Answer the user's exact question directly and thoroughly. Use Google Search grounding to fetch current data — price, news, earnings, analyst ratings, fundamentals — and cite sources inline as [1], [2] when used.

Write for a retail investor who wants real detail: specific numbers, dates, named competitors, actual figures. No filler, no hedging, no forced structure. Match your response format to what was asked — if they ask one question, answer it deeply. If they want a broad overview, give a comprehensive one. Be dense and useful.`;

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