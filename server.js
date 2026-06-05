try { require("dotenv").config(); } catch(e) {}

const express = require("express");
const fetch   = (...a) => import("node-fetch").then(({default:f})=>f(...a));
const fs      = require("fs");
const path    = require("path");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

// Current active Groq models — smallest first to save daily quota
const MODELS = [
  "llama-3.1-8b-instant",                    // 8B — fastest, fewest tokens
  "llama-3.3-70b-versatile",                 // 70B — better quality
  "meta-llama/llama-4-scout-17b-16e-instruct", // Llama 4 Scout — separate quota
  "qwen/qwen3-32b",                          // Qwen 32B — extra fallback
];

async function callGroq(prompt, modelIndex = 0) {
  if (modelIndex >= MODELS.length) {
    throw new Error("Daily token limit reached on all models. Please try again in a few hours, or tomorrow.");
  }
  const model = MODELS[modelIndex];
  const key = process.env.GROQ_API_KEY;

  console.log(`Trying model: ${model}`);

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + key
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are an expert document reviewer. Respond with ONLY a valid JSON object. No markdown, no code fences, no extra text. Your entire response must start with { and end with }."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 2048,
      response_format: { type: "json_object" }
    }),
  });

  const data = await r.json();

  // Rate limit or quota — try next model
  if (r.status === 429 || (data.error?.message || "").toLowerCase().includes("rate limit") || (data.error?.message || "").toLowerCase().includes("quota")) {
    console.log(`Model ${model} rate-limited, trying next...`);
    return callGroq(prompt, modelIndex + 1);
  }

  // Decommissioned model — try next
  if ((data.error?.message || "").toLowerCase().includes("decommissioned") || (data.error?.message || "").toLowerCase().includes("deprecated")) {
    console.log(`Model ${model} decommissioned, trying next...`);
    return callGroq(prompt, modelIndex + 1);
  }

  if (!r.ok) throw new Error(data.error?.message || `Groq API error ${r.status}`);

  const raw = data.choices?.[0]?.message?.content || "";
  if (!raw) throw new Error("Empty response from model");

  // Robustly extract JSON
  const start = raw.indexOf("{");
  const end   = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in response");

  return JSON.parse(raw.slice(start, end + 1));
}

// ── Review endpoint ────────────────────────────────────────────────────────────
app.post("/api/review", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "No prompt provided." });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: "GROQ_API_KEY not set on server." });

  try {
    const result = await callGroq(prompt);
    res.json({ result });
  } catch (e) {
    console.error("Review error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Ping — for cold start detection ──────────────────────────────────────────
app.get("/api/ping", (req, res) => res.json({ ok: true }));

// ── Ping — cold start detection ───────────────────────────────────────────────
app.get("/api/ping", (req, res) => res.json({ ok: true }));

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
app.listen(PORT, () => console.log(`✅ Document Reviewer → http://localhost:${PORT}`));
