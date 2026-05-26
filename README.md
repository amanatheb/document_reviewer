# ICP Document Reviewer

Upload a doc or paste a URL → get an instant devil's advocate review against your auto-detected ICP.

## Local setup
```bash
npm install
cp .env.example .env   # add your ANTHROPIC_API_KEY
npm start
# open http://localhost:3000
```

## Deploy to Render (free)
1. Push this repo to GitHub
2. Go to render.com → New Web Service → connect repo
3. Build: `npm install` | Start: `npm start`
4. Add env var: ANTHROPIC_API_KEY = sk-ant-...
5. Deploy → get your live URL
