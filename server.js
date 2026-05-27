try { require("dotenv").config(); } catch(e) {}

const express = require("express");
const fetch   = (...a) => import("node-fetch").then(({default:f})=>f(...a));
const fs      = require("fs");
const path    = require("path");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

// Models tried in order — if one hits rate limit, next is tried
const MODELS = [
  "llama-3.1-8b-instant",      // smallest, fastest, fewest tokens
  "gemma2-9b-it",               // Google Gemma — separate quota
  "llama-3.3-70b-versatile",    // full model, used last to save quota
];

async function callGroq(prompt, modelIndex = 0) {
  if (modelIndex >= MODELS.length) throw new Error("All models rate-limited. Please try again in a few minutes.");
  const model = MODELS[modelIndex];
  const key = process.env.GROQ_API_KEY;

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are an expert document reviewer. Respond with ONLY a valid JSON object. No markdown, no code fences, no explanation. Start with { and end with }." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 2048,
      response_format: { type: "json_object" }
    }),
  });

  const data = await r.json();

  // Rate limit — try next model
  if (r.status === 429 || data.error?.message?.includes("rate limit") || data.error?.message?.includes("Rate limit")) {
    console.log(`Model ${model} rate-limited, trying next...`);
    return callGroq(prompt, modelIndex + 1);
  }

  if (!r.ok) throw new Error(data.error?.message || `API error ${r.status}`);

  const raw = data.choices?.[0]?.message?.content || "";
  if (!raw) throw new Error("Empty response");

  const start = raw.indexOf("{");
  const end   = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in response");

  return JSON.parse(raw.slice(start, end + 1));
}

// ── Review endpoint ────────────────────────────────────────────────────────────
app.post("/api/review", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "No prompt provided." });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: "GROQ_API_KEY not set." });
  try {
    const result = await callGroq(prompt);
    res.json({ result });
  } catch (e) {
    console.error("Review error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── URL fetch proxy ────────────────────────────────────────────────────────────
app.post("/api/fetch-url", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "No URL provided." });
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ICPReviewer/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    res.json({ html: await r.text() });
  } catch (e) {
    res.status(500).json({ error: "Could not fetch URL: " + e.message });
  }
});

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ ICP Reviewer → http://localhost:${PORT}`));
