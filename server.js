try { require("dotenv").config(); } catch(e) {}

const express = require("express");
const fetch   = (...a) => import("node-fetch").then(({default:f})=>f(...a));
const fs      = require("fs");
const path    = require("path");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

// debug — logs all env keys on startup (not values)
console.log("ENV KEYS:", Object.keys(process.env).filter(k=>k.includes('GROQ')||k.includes('API')));

// ── Groq review ───────────────────────────────────────────────────────────────
app.post("/api/review", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "No prompt provided." });

  const key = process.env.GROQ_API_KEY;
  console.log("GROQ key present:", !!key, "length:", key ? key.length : 0);

  if (!key) return res.status(500).json({ error: "GROQ_API_KEY not set on server. Keys found: " + Object.keys(process.env).join(",").slice(0,200) });

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
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
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "Groq API error" });

    const raw = data.choices?.[0]?.message?.content || "";
    if (!raw) throw new Error("Empty response from Groq");

    const start = raw.indexOf("{");
    const end   = raw.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON in response: " + raw.slice(0,200));

    res.json({ result: JSON.parse(raw.slice(start, end + 1)) });
  } catch (e) {
    console.error("Review error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── URL fetch proxy ───────────────────────────────────────────────────────────
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
app.listen(PORT, () => console.log(`✅ ICP Reviewer running on port ${PORT}`));
