require("dotenv").config();
const express = require("express");
const fetch   = (...a) => import("node-fetch").then(({default:f})=>f(...a));
const fs      = require("fs");
const path    = require("path");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

// ── Gemini review ─────────────────────────────────────────────────────────────
app.post("/api/review", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "No prompt provided." });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "GEMINI_API_KEY not set on server." });

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
        }),
      }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "Gemini API error" });

    const raw   = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const start = raw.indexOf("{");
    const end   = raw.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON in response");
    const result = JSON.parse(raw.slice(start, end + 1));
    res.json({ result });
  } catch (e) {
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
    const html = await r.text();
    res.json({ html });
  } catch (e) {
    res.status(500).json({ error: "Could not fetch URL: " + e.message });
  }
});

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n✅  ICP Reviewer → http://localhost:${PORT}\n`));
