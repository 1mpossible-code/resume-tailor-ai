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
  async generateTailoredResume({ prompt }) {
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
            responseMimeType: "application/json"
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

    const jsonText = extractJsonText(text);
    return JSON.parse(jsonText);
  }
}
