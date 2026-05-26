require("dotenv").config();
const express = require("express");
const multer  = require("multer");
const fetch   = (...a) => import("node-fetch").then(({default:f})=>f(...a));
const fs      = require("fs");
const path    = require("path");

const app    = express();
const upload = multer({ dest: "uploads/", limits: { fileSize: 20*1024*1024 } });

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

// ── Anthropic review ──────────────────────────────────────────────────────────
app.post("/api/review", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "No prompt provided." });
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set on server." });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "API error" });

    const raw   = (data.content || []).map(b => b.text || "").join("");
    const start = raw.indexOf("{");
    const end   = raw.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON in Claude response");
    const result = JSON.parse(raw.slice(start, end + 1));
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── URL fetch proxy (avoids CORS in browser) ─────────────────────────────────
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

// ── Cleanup uploads dir on start ─────────────────────────────────────────────
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n✅  ICP Reviewer → http://localhost:${PORT}\n`));
