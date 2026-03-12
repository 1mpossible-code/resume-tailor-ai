import { AIProvider } from "./base.js";

function stripCodeFences(text) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function extractJsonText(rawText) {
  const cleaned = stripCodeFences(rawText);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model response did not include a valid JSON object");
  }

  return cleaned.slice(start, end + 1);
}

export class GeminiProvider extends AIProvider {
  async callGemini({ prompt, responseMimeType = "application/json" }) {
    const apiKey = this.config.apiKey;
    const model = this.config.model || "gemini-2.5-flash";

    if (!apiKey) {
      throw new Error("Missing GEMINI_API_KEY");
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            topP: 0.9,
            responseMimeType
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts;

    if (!Array.isArray(parts) || parts.length === 0) {
      throw new Error("Gemini returned an empty response");
    }

    const text = parts.map((part) => part.text || "").join("\n").trim();
    if (!text) {
      throw new Error("Gemini response text was empty");
    }

    return text;
  }

  async generateTailoredResume({ prompt }) {
    const text = await this.callGemini({ prompt, responseMimeType: "application/json" });

    const jsonText = extractJsonText(text);
    return JSON.parse(jsonText);
  }

  async extractJobTarget({ jobDescription }) {
    const prompt = [
      "Extract company and position from this job description.",
      "Return strict JSON with exactly these keys:",
      '{"company":"...","position":"..."}',
      "Rules:",
      "- If missing, use empty string",
      "- No extra keys",
      "- Keep concise values",
      "Job description:",
      jobDescription
    ].join("\n");

    const text = await this.callGemini({ prompt, responseMimeType: "application/json" });
    const parsed = JSON.parse(extractJsonText(text));

    return {
      company: typeof parsed.company === "string" ? parsed.company.trim() : "",
      position: typeof parsed.position === "string" ? parsed.position.trim() : ""
    };
  }
}
