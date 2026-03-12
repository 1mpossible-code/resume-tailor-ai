# Resume Tailor AI

Local web app that tailors your resume to a job description using Gemini, then renders output with `resumed` + the internships-focused engineering theme from `1mpossible-code/jsonresume-theme-engineering-internships`.

## Features

- Job description textarea UI
- Job posting URL extraction (recommended)
- In-browser JSON resume editor
- Base resume saved in browser localStorage
- Import/export base resume JSON
- AI-tailored JSON Resume output (Gemini provider)
- Rendered HTML preview
- One-click JSON copy button
- One-click PDF download button
- Section toggles for PDF/preview layout (with local default preferences)
- Keeps only the latest 20 generated resumes in history by default
- Docker-ready setup
- If PDF export fails, HTML preview still returns

## Requirements

- Node.js 20+
- Gemini API key

## Local run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create env file:

   ```bash
   cp .env.example .env
   ```

3. Set `GEMINI_API_KEY` in `.env`.

4. Start app:

   ```bash
   npm start
   ```

5. Open `http://localhost:3000`.

## Docker run

1. Create env file:

   ```bash
   cp .env.example .env
   ```

2. Set `GEMINI_API_KEY` in `.env`.

3. Build and run:

   ```bash
   docker compose up --build
   ```

4. Open `http://localhost:3000`.

If you are on Apple Silicon, this image now uses system Chromium inside the container to avoid Puppeteer architecture issues.

## Config

- `AI_PROVIDER`: `gemini` (default), `codex` (placeholder)
- `AI_MODEL`: defaults to `gemini-2.5-flash`
- `GEMINI_API_KEY`: required for Gemini calls
- `PORT`: defaults to `3000`
- `HISTORY_LIMIT`: defaults to `20`

## Notes

- Base resume source is your browser localStorage.
- You must save or import your resume JSON in the editor before generating.
- Prompt template source is always `prompt.txt`.
- Generated files are written to `outputs/`.
- History list is tracked in `outputs/history.json` and auto-pruned to `HISTORY_LIMIT` items.
- Section layout defaults are empty (no sections disabled) and can be customized per browser via localStorage.
