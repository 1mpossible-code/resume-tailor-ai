const jobDescriptionInput = document.getElementById("jobDescription");
const jobUrlInput = document.getElementById("jobUrl");
const resumeJsonInput = document.getElementById("resumeJson");
const importResumeFileInput = document.getElementById("importResumeFile");
const extractBtn = document.getElementById("extractBtn");
const generateBtn = document.getElementById("generateBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const saveResumeBtn = document.getElementById("saveResumeBtn");
const formatResumeBtn = document.getElementById("formatResumeBtn");
const copyResumeBtn = document.getElementById("copyResumeBtn");
const importResumeBtn = document.getElementById("importResumeBtn");
const exportResumeBtn = document.getElementById("exportResumeBtn");
const copyJsonBtn = document.getElementById("copyJsonBtn");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");
const previewFrame = document.getElementById("previewFrame");
const historyList = document.getElementById("historyList");
const statusEl = document.getElementById("status");

const localStorageResumeKey = "resumeTailor.baseResume";

let selectedItem = null;

function defaultResume() {
  return {
    basics: {
      name: "Your Name",
      label: "Software Engineer",
      email: "you@example.com",
      summary: "Write a concise summary tailored to your target role.",
      location: {
        city: "",
        countryCode: "",
        region: ""
      }
    },
    work: [],
    education: [],
    skills: []
  };
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#a9362e" : "#5b6b7a";
}

function setLoading(isLoading) {
  generateBtn.disabled = isLoading;
  generateBtn.textContent = isLoading ? "Generating..." : "Generate Resume";
  extractBtn.disabled = isLoading;
}

function setExtractLoading(isLoading) {
  extractBtn.disabled = isLoading;
  extractBtn.textContent = isLoading ? "Extracting..." : "Extract From Link";
}

function parseResumeEditorText() {
  const text = resumeJsonInput.value.trim();
  if (!text) {
    throw new Error("Resume JSON cannot be empty");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Resume JSON is not valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Resume JSON must be an object");
  }

  if (!parsed.basics || typeof parsed.basics !== "object") {
    throw new Error("Resume JSON must include 'basics' object");
  }

  for (const key of ["work", "education", "skills"]) {
    if (!Array.isArray(parsed[key])) {
      throw new Error(`Resume JSON must include '${key}' array`);
    }
  }

  return parsed;
}

function storeResume(parsedResume, message) {
  const pretty = JSON.stringify(parsedResume, null, 2);
  resumeJsonInput.value = pretty;
  localStorage.setItem(localStorageResumeKey, pretty);
  if (message) {
    setStatus(message);
  }
}

function initializeResumeEditor() {
  const stored = localStorage.getItem(localStorageResumeKey);
  if (stored) {
    resumeJsonInput.value = stored;
    return;
  }

  storeResume(defaultResume(), "Created a starter resume in local storage.");
}

function setSelectedItem(item) {
  selectedItem = item;

  if (!item) {
    copyJsonBtn.disabled = true;
    downloadPdfBtn.classList.add("disabled");
    downloadPdfBtn.href = "#";
    previewFrame.src = "about:blank";
    return;
  }

  copyJsonBtn.disabled = false;
  if (item.hasPdf && item.pdfUrl) {
    downloadPdfBtn.classList.remove("disabled");
    downloadPdfBtn.href = item.pdfUrl;
    downloadPdfBtn.download = `${item.fileBaseName || `tailored-resume-${item.id}`}.pdf`;
  } else {
    downloadPdfBtn.classList.add("disabled");
    downloadPdfBtn.href = "#";
    downloadPdfBtn.removeAttribute("download");
  }
  previewFrame.src = item.htmlUrl;
}

async function loadHistory() {
  const response = await fetch("/api/history");
  const data = await response.json();
  const items = data.items || [];

  historyList.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");

    const meta = document.createElement("div");
    meta.className = "history-meta";

    const preview = document.createElement("div");
    preview.className = "history-preview";
    preview.textContent = item.strictResumeName || item.jobDescriptionPreview || "No job description preview";

    const date = document.createElement("div");
    date.className = "history-date";
    date.textContent = new Date(item.createdAt).toLocaleString();

    meta.append(preview, date);

    const actions = document.createElement("div");
    actions.className = "actions";

    const openBtn = document.createElement("button");
    openBtn.className = "btn secondary";
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", () => {
      setSelectedItem(item);
      setStatus("Loaded resume from history.");
    });

    const pdfLink = document.createElement("a");
    pdfLink.className = "btn secondary";
    if (item.hasPdf && item.pdfUrl) {
      pdfLink.href = item.pdfUrl;
      pdfLink.download = `${item.fileBaseName || `tailored-resume-${item.id}`}.pdf`;
      pdfLink.textContent = "PDF";
    } else {
      pdfLink.href = "#";
      pdfLink.textContent = "No PDF";
      pdfLink.classList.add("disabled");
    }

    actions.append(openBtn, pdfLink);
    li.append(meta, actions);
    historyList.appendChild(li);
  }

  if (!selectedItem && items.length > 0) {
    setSelectedItem(items[0]);
  }
}

async function generateResume() {
  const jobDescription = jobDescriptionInput.value.trim();
  const jobUrl = jobUrlInput.value.trim();
  if (!jobDescription && !jobUrl) {
    setStatus("Paste a job description or provide a job link.", true);
    return;
  }

  let resumeJson;
  try {
    resumeJson = parseResumeEditorText();
    storeResume(resumeJson);
  } catch (error) {
    setStatus(error.message || "Invalid resume JSON", true);
    return;
  }

  try {
    setLoading(true);
    setStatus("Generating tailored resume...");

    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobDescription, jobUrl, resumeJson })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Generation failed");
    }

    setSelectedItem(data.item);
    if (data.item.warning) {
      setStatus(data.item.warning, true);
    } else {
      setStatus("Resume generated. Use Copy JSON or Download PDF.");
    }
    await loadHistory();
  } catch (error) {
    setStatus(error.message || "Unexpected error", true);
  } finally {
    setLoading(false);
  }
}

async function extractFromLink() {
  const url = jobUrlInput.value.trim();
  if (!url) {
    setStatus("Please enter a job posting link first.", true);
    return;
  }

  try {
    setExtractLoading(true);
    setStatus("Extracting job description from link...");

    const response = await fetch("/api/extract-job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Extraction failed");
    }

    jobDescriptionInput.value = data.jobDescription;
    setStatus("Job description extracted. Ready to generate.");
  } catch (error) {
    setStatus(error.message || "Failed to extract job description", true);
  } finally {
    setExtractLoading(false);
  }
}

async function copyGeneratedJson() {
  if (!selectedItem) {
    return;
  }

  try {
    const response = await fetch(selectedItem.jsonUrl);
    if (!response.ok) {
      throw new Error("Failed to load JSON");
    }

    const text = await response.text();
    await navigator.clipboard.writeText(text);
    setStatus("Tailored JSON copied to clipboard.");
  } catch (error) {
    setStatus(error.message || "Copy failed", true);
  }
}

function saveResume() {
  try {
    const parsed = parseResumeEditorText();
    storeResume(parsed, "Base resume saved in local storage.");
  } catch (error) {
    setStatus(error.message || "Could not save resume", true);
  }
}

function formatResume() {
  try {
    const parsed = parseResumeEditorText();
    storeResume(parsed, "Resume JSON formatted.");
  } catch (error) {
    setStatus(error.message || "Could not format resume", true);
  }
}

async function copyBaseResume() {
  try {
    const parsed = parseResumeEditorText();
    const text = JSON.stringify(parsed, null, 2);
    await navigator.clipboard.writeText(text);
    setStatus("Base resume JSON copied.");
  } catch (error) {
    setStatus(error.message || "Copy failed", true);
  }
}

function exportBaseResume() {
  try {
    const parsed = parseResumeEditorText();
    const text = JSON.stringify(parsed, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "resume.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("Base resume exported.");
  } catch (error) {
    setStatus(error.message || "Export failed", true);
  }
}

async function importBaseResumeFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    resumeJsonInput.value = text;
    const parsed = parseResumeEditorText();
    storeResume(parsed, "Resume imported and saved.");
  } catch (error) {
    setStatus(error.message || "Import failed", true);
  } finally {
    importResumeFileInput.value = "";
  }
}

async function clearHistory() {
  try {
    const response = await fetch("/api/history", { method: "DELETE" });
    if (!response.ok) {
      throw new Error("Failed to clear history");
    }

    setSelectedItem(null);
    await loadHistory();
    setStatus("History cleared.");
  } catch (error) {
    setStatus(error.message || "Failed to clear history", true);
  }
}

generateBtn.addEventListener("click", generateResume);
extractBtn.addEventListener("click", extractFromLink);
copyJsonBtn.addEventListener("click", copyGeneratedJson);
clearHistoryBtn.addEventListener("click", clearHistory);
saveResumeBtn.addEventListener("click", saveResume);
formatResumeBtn.addEventListener("click", formatResume);
copyResumeBtn.addEventListener("click", copyBaseResume);
exportResumeBtn.addEventListener("click", exportBaseResume);
importResumeBtn.addEventListener("click", () => importResumeFileInput.click());
importResumeFileInput.addEventListener("change", importBaseResumeFile);

initializeResumeEditor();
loadHistory().catch(() => {
  setStatus("Could not load history.", true);
});
