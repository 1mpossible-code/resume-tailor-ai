import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import {
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { createProvider } from "./src/providers/index.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const historyLimit = Number(process.env.HISTORY_LIMIT || 20);

const promptPath = path.join(__dirname, "prompt.txt");
const outputDir = path.join(__dirname, "outputs");
const historyPath = path.join(outputDir, "history.json");
const maxHistory = Number.isInteger(historyLimit) && historyLimit > 0 ? historyLimit : 20;

const resumedBin = path.join(
  __dirname,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "resumed.cmd" : "resumed"
);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/outputs", express.static(outputDir, { index: false }));

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateResumeShape(resume) {
  if (!isPlainObject(resume)) {
    throw new Error("Tailored resume must be a JSON object");
  }

  if (!isPlainObject(resume.basics)) {
    throw new Error("Tailored resume is missing 'basics'");
  }

  const arraySections = ["work", "education", "skills"];
  for (const section of arraySections) {
    if (!Array.isArray(resume[section])) {
      throw new Error(`Tailored resume is missing '${section}' array`);
    }
  }
}

function parseResumeInput(resumeInput) {
  if (isPlainObject(resumeInput)) {
    return resumeInput;
  }

  if (typeof resumeInput === "string") {
    const trimmed = resumeInput.trim();
    if (!trimmed) {
      throw new Error("Resume JSON is required");
    }
    return JSON.parse(trimmed);
  }

  throw new Error("Resume JSON is required");
}

function normalizeDateValue(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^(present|current|now)$/i.test(trimmed)) {
    return "";
  }

  if (/^\d{4}$/.test(trimmed)) {
    return `${trimmed}-01-01`;
  }

  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    return `${trimmed}-01`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return "";
}

function normalizeResumeDates(resume) {
  const dateFieldsBySection = {
    work: ["startDate", "endDate"],
    volunteer: ["startDate", "endDate"],
    education: ["startDate", "endDate"],
    awards: ["date"],
    publications: ["releaseDate"],
    certificates: ["date"]
  };

  for (const [section, fields] of Object.entries(dateFieldsBySection)) {
    if (!Array.isArray(resume[section])) {
      continue;
    }

    for (const item of resume[section]) {
      if (!isPlainObject(item)) {
        continue;
      }

      for (const field of fields) {
        if (field in item) {
          item[field] = normalizeDateValue(item[field]);
        }
      }
    }
  }
}

const supportedSectionConfigs = [
  { key: "summary", type: "summary" },
  { key: "work", type: "array" },
  { key: "education", type: "array" },
  { key: "skills", type: "array" },
  { key: "volunteer", type: "array" },
  { key: "awards", type: "array" },
  { key: "projects", type: "array" },
  { key: "publications", type: "array" },
  { key: "certificates", type: "array" },
  { key: "interests", type: "array" },
  { key: "languages", type: "array" },
  { key: "references", type: "array" }
];

function analyzeSectionControls(resume) {
  const availableSections = [];
  const sectionPresence = {};

  for (const section of supportedSectionConfigs) {
    let hasKey = false;
    let hasContent = false;

    if (section.type === "summary") {
      hasKey = isPlainObject(resume?.basics) && "summary" in resume.basics;
      hasContent = Boolean(resume?.basics?.summary && String(resume.basics.summary).trim());
    } else {
      hasKey = Array.isArray(resume?.[section.key]);
      hasContent = hasKey && resume[section.key].length > 0;
    }

    if (hasKey) {
      availableSections.push(section.key);
    }

    sectionPresence[section.key] = hasContent;
  }

  return { availableSections, sectionPresence };
}

function normalizeDisabledSections(disabledSections, availableSections) {
  if (!Array.isArray(disabledSections)) {
    return [];
  }

  const availableSet = new Set(availableSections);
  const normalized = new Set();
  for (const section of disabledSections) {
    if (typeof section === "string" && availableSet.has(section)) {
      normalized.add(section);
    }
  }

  return Array.from(normalized);
}

function buildRenderResume(resume, disabledSections) {
  const copy = structuredClone(resume);
  const disabledSet = new Set(disabledSections);

  if (disabledSet.has("summary") && isPlainObject(copy.basics)) {
    copy.basics.summary = "";
  }

  const arraySections = supportedSectionConfigs
    .filter((section) => section.type === "array")
    .map((section) => section.key);

  for (const section of arraySections) {
    if (disabledSet.has(section) && Array.isArray(copy[section])) {
      copy[section] = [];
    }
  }

  return copy;
}

function buildPrompt(template, resumeObj, jobDescription) {
  const resumeJson = JSON.stringify(resumeObj, null, 2);
  let prompt = template
    .replace("[[resume]]", resumeJson)
    .replace("[[job description]]", jobDescription);

  prompt +=
    "\n\nOutput requirement: Return only valid JSON Resume content as a JSON object. No markdown fences, no explanations.";

  return prompt;
}

function assertValidHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Please enter a valid job posting URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https job URLs are supported");
  }

  return url.toString();
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function toSafeNamePart(value, fallback = "Unknown") {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || fallback;
}

function toFileBaseName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function fallbackCompanyFromUrl(rawJobUrl) {
  if (!rawJobUrl) {
    return "";
  }

  try {
    const host = new URL(rawJobUrl).hostname.replace(/^www\./, "");
    const firstPart = host.split(".")[0] || "";
    if (!firstPart) {
      return "";
    }
    return firstPart.charAt(0).toUpperCase() + firstPart.slice(1);
  } catch {
    return "";
  }
}

function fallbackPositionFromDescription(jobDescription) {
  const firstLines = jobDescription
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);

  const rolePattern = /(staff|senior|lead|principal|junior)?\s*(software|backend|frontend|full[- ]?stack|data|machine learning|ml|devops|platform|site reliability|security)?\s*(engineer|developer|scientist|manager|architect)/i;

  for (const line of firstLines) {
    const match = line.match(rolePattern);
    if (match) {
      return line.length <= 90 ? line : match[0];
    }
  }

  return "";
}

async function buildResumeName({ provider, jobDescription, rawJobUrl, resumeName }) {
  let company = "";
  let position = "";

  if (provider && typeof provider.extractJobTarget === "function") {
    try {
      const extracted = await provider.extractJobTarget({ jobDescription });
      if (isPlainObject(extracted)) {
        company = String(extracted.company || "").trim();
        position = String(extracted.position || "").trim();
      }
    } catch {
      // Fallbacks below handle extraction failures.
    }
  }

  if (!company) {
    company = fallbackCompanyFromUrl(rawJobUrl);
  }

  if (!position) {
    position = fallbackPositionFromDescription(jobDescription);
  }

  const safeName = toSafeNamePart(resumeName, "Candidate");
  const safeCompany = toSafeNamePart(company, "Unknown Company");
  const safePosition = toSafeNamePart(position, "Unknown Position");

  const strictResumeName = `${safeName} - ${safeCompany} - ${safePosition}`;
  return {
    strictResumeName,
    fileBaseName: toFileBaseName(strictResumeName)
  };
}

function extractJobDescriptionFromHtml(html) {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();

  const selectorCandidates = [
    '[data-testid*="jobDescription" i]',
    '[class*="job-description" i]',
    '[id*="job-description" i]',
    "main",
    "article",
    "body"
  ];

  let bestText = "";
  for (const selector of selectorCandidates) {
    $(selector).each((_idx, node) => {
      const text = normalizeWhitespace($(node).text());
      if (text.length > bestText.length) {
        bestText = text;
      }
    });

    if (bestText.length > 1500) {
      break;
    }
  }

  if (!bestText) {
    throw new Error("Could not extract text from the provided URL");
  }

  if (bestText.length < 200) {
    throw new Error("Extracted text is too short. The page may block scraping.");
  }

  return bestText.slice(0, 20000);
}

async function extractJobDescriptionFromUrl(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch job URL (${response.status})`);
  }

  const html = await response.text();
  return extractJobDescriptionFromHtml(html);
}

async function runResumed(args) {
  try {
    await execFileAsync(resumedBin, args, { cwd: __dirname, maxBuffer: 1024 * 1024 * 20 });
  } catch (error) {
    const details = error.stderr || error.stdout || error.message;
    throw new Error(`resumed command failed: ${details}`);
  }
}

async function renderOutputsFromResume({ resume, id }) {
  const sourceJsonPath = path.join(outputDir, `${id}.render.json`);
  const htmlPath = path.join(outputDir, `${id}.html`);
  const pdfPath = path.join(outputDir, `${id}.pdf`);

  await writeFile(sourceJsonPath, JSON.stringify(resume, null, 2), "utf8");

  await runResumed([
    "render",
    sourceJsonPath,
    "--theme",
    "jsonresume-theme-engineering",
    "--output",
    htmlPath
  ]);

  let hasPdf = false;
  let warning = null;
  try {
    await runResumed([
      "export",
      sourceJsonPath,
      "--theme",
      "jsonresume-theme-engineering",
      "--output",
      pdfPath,
      "--puppeteer-arg=--no-sandbox",
      "--puppeteer-arg=--disable-setuid-sandbox"
    ]);
    hasPdf = true;
  } catch (error) {
    warning = `PDF export failed, but HTML preview is ready. ${error.message}`;
  }

  await unlink(sourceJsonPath).catch(() => {});

  return { htmlPath, pdfPath, hasPdf, warning };
}

async function ensureStorage() {
  await mkdir(outputDir, { recursive: true });
  try {
    await stat(historyPath);
  } catch {
    await writeFile(historyPath, "[]\n", "utf8");
  }
}

async function readHistory() {
  await ensureStorage();
  const raw = await readFile(historyPath, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function writeHistory(items) {
  await writeFile(historyPath, JSON.stringify(items, null, 2), "utf8");
}

async function deleteEntryFiles(entry) {
  const candidates = [entry?.jsonPath, entry?.htmlPath, entry?.pdfPath];
  for (const filePath of candidates) {
    const resolvedPath = resolveOutputPath(filePath);
    if (!resolvedPath) {
      continue;
    }
    await unlink(resolvedPath).catch(() => {});
  }
}

function resolveOutputPath(storedPath) {
  if (!storedPath || typeof storedPath !== "string") {
    return null;
  }

  return path.join(outputDir, path.basename(storedPath));
}

function makeEntryResponse(entry) {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    provider: entry.provider,
    model: entry.model,
    jobDescriptionPreview: entry.jobDescriptionPreview,
    htmlUrl: `/outputs/${entry.id}.html`,
    strictResumeName: entry.strictResumeName,
    fileBaseName: entry.fileBaseName,
    availableSections: Array.isArray(entry.availableSections) ? entry.availableSections : [],
    disabledSections: Array.isArray(entry.disabledSections) ? entry.disabledSections : [],
    sectionPresence: isPlainObject(entry.sectionPresence) ? entry.sectionPresence : {},
    hasPdf: Boolean(entry.hasPdf),
    pdfUrl: entry.hasPdf ? `/outputs/${entry.id}.pdf` : null,
    jsonUrl: `/api/history/${entry.id}/json`,
    warning: entry.warning || null
  };
}

async function hydrateEntrySections(entry) {
  const jsonPath = resolveOutputPath(entry.jsonPath);
  if (!jsonPath) {
    return {
      ...entry,
      availableSections: [],
      sectionPresence: {}
    };
  }

  try {
    const raw = await readFile(jsonPath, "utf8");
    const resume = JSON.parse(raw);
    const analysis = analyzeSectionControls(resume);
    return {
      ...entry,
      availableSections: analysis.availableSections,
      sectionPresence: analysis.sectionPresence,
      disabledSections: normalizeDisabledSections(
        entry.disabledSections,
        analysis.availableSections
      )
    };
  } catch {
    return {
      ...entry,
      availableSections: [],
      sectionPresence: {}
    };
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/extract-job", async (req, res) => {
  const rawUrl = String(req.body?.url || "").trim();
  if (!rawUrl) {
    res.status(400).json({ error: "Job URL is required" });
    return;
  }

  try {
    const url = assertValidHttpUrl(rawUrl);
    const jobDescription = await extractJobDescriptionFromUrl(url);
    res.json({ jobDescription, sourceUrl: url });
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to extract job description" });
  }
});

app.get("/api/history", async (_req, res) => {
  const history = await readHistory();
  const hydratedHistory = await Promise.all(history.map(hydrateEntrySections));
  await writeHistory(hydratedHistory);
  res.json({ items: hydratedHistory.map(makeEntryResponse) });
});

app.get("/api/history/:id/json", async (req, res) => {
  const history = await readHistory();
  const entry = history.find((item) => item.id === req.params.id);
  if (!entry) {
    res.status(404).json({ error: "History item not found" });
    return;
  }

  const jsonPath = resolveOutputPath(entry.jsonPath);
  if (!jsonPath) {
    res.status(404).json({ error: "History JSON is unavailable" });
    return;
  }

  const jsonText = await readFile(jsonPath, "utf8");
  res.type("application/json").send(jsonText);
});

app.post("/api/history/:id/render", async (req, res) => {
  try {
    const history = await readHistory();
    const index = history.findIndex((item) => item.id === req.params.id);
    if (index === -1) {
      res.status(404).json({ error: "History item not found" });
      return;
    }

    const entry = history[index];
    const jsonPath = resolveOutputPath(entry.jsonPath);
    if (!jsonPath) {
      res.status(404).json({ error: "History JSON is unavailable" });
      return;
    }

    const rawJson = await readFile(jsonPath, "utf8");
    const tailoredResume = JSON.parse(rawJson);
    normalizeResumeDates(tailoredResume);

    const analysis = analyzeSectionControls(tailoredResume);
    const availableSections = analysis.availableSections;
    const disabledSections = normalizeDisabledSections(req.body?.disabledSections, availableSections);
    const renderResume = buildRenderResume(tailoredResume, disabledSections);

    const renderResult = await renderOutputsFromResume({
      resume: renderResume,
      id: entry.id
    });

    const updatedEntry = {
      ...entry,
      availableSections,
      sectionPresence: analysis.sectionPresence,
      disabledSections,
      htmlPath: path.basename(renderResult.htmlPath),
      pdfPath: path.basename(renderResult.pdfPath),
      hasPdf: renderResult.hasPdf,
      warning: renderResult.warning
    };

    history[index] = updatedEntry;
    await writeHistory(history);

    res.json({ item: makeEntryResponse(updatedEntry) });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to re-render resume"
    });
  }
});

app.post("/api/generate", async (req, res) => {
  let jobDescription = String(req.body?.jobDescription || "").trim();
  const rawJobUrl = String(req.body?.jobUrl || "").trim();
  let baseResume;

  try {
    baseResume = parseResumeInput(req.body?.resumeJson);
    normalizeResumeDates(baseResume);
    validateResumeShape(baseResume);
  } catch (error) {
    res.status(400).json({
      error: `Invalid base resume JSON: ${error.message || "unknown error"}`
    });
    return;
  }

  if (!jobDescription && rawJobUrl) {
    try {
      const url = assertValidHttpUrl(rawJobUrl);
      jobDescription = await extractJobDescriptionFromUrl(url);
    } catch (error) {
      res.status(400).json({
        error: error.message || "Could not extract job description from URL"
      });
      return;
    }
  }

  if (!jobDescription) {
    res.status(400).json({ error: "Job description or job URL is required" });
    return;
  }

  try {
    const promptTemplate = await readFile(promptPath, "utf8");
    const providerName = process.env.AI_PROVIDER || "gemini";
    const model = process.env.AI_MODEL || "gemini-2.5-flash";

    const provider = createProvider(providerName, {
      apiKey: process.env.GEMINI_API_KEY,
      model
    });

    const prompt = buildPrompt(promptTemplate, baseResume, jobDescription);
    const tailoredResume = await provider.generateTailoredResume({
      prompt,
      resume: baseResume,
      jobDescription
    });
    normalizeResumeDates(tailoredResume);
    validateResumeShape(tailoredResume);

    const analysis = analyzeSectionControls(tailoredResume);
    const availableSections = analysis.availableSections;
    const disabledSections = normalizeDisabledSections(req.body?.disabledSections, availableSections);
    const renderResume = buildRenderResume(tailoredResume, disabledSections);

    const { strictResumeName, fileBaseName } = await buildResumeName({
      provider,
      jobDescription,
      rawJobUrl,
      resumeName: tailoredResume?.basics?.name || baseResume?.basics?.name || "Candidate"
    });

    await ensureStorage();
    const id = `${Date.now()}`;
    const jsonPath = path.join(outputDir, `${id}.json`);

    await writeFile(jsonPath, JSON.stringify(tailoredResume, null, 2), "utf8");
    const renderResult = await renderOutputsFromResume({
      resume: renderResume,
      id
    });

    const history = await readHistory();
    const entry = {
      id,
      createdAt: new Date().toISOString(),
      provider: providerName,
      model,
      jobDescriptionPreview: jobDescription.slice(0, 140),
      strictResumeName,
      fileBaseName,
      availableSections,
      sectionPresence: analysis.sectionPresence,
      disabledSections,
      jsonPath: path.basename(jsonPath),
      htmlPath: path.basename(renderResult.htmlPath),
      pdfPath: path.basename(renderResult.pdfPath),
      hasPdf: renderResult.hasPdf,
      warning: renderResult.warning
    };

    const nextHistory = [entry, ...history];
    const keep = nextHistory.slice(0, maxHistory);
    const remove = nextHistory.slice(maxHistory);

    for (const staleEntry of remove) {
      await deleteEntryFiles(staleEntry);
    }

    await writeHistory(keep);
    res.json({ item: makeEntryResponse(entry) });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to generate tailored resume"
    });
  }
});

app.delete("/api/history", async (_req, res) => {
  const history = await readHistory();
  for (const entry of history) {
    await deleteEntryFiles(entry);
  }

  await writeHistory([]);

  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Resume Tailor AI running at http://localhost:${port}`);
});
