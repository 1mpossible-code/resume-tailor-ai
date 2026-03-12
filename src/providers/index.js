import { CodexProvider } from "./codex.js";
import { GeminiProvider } from "./gemini.js";

export function createProvider(name, config) {
  const provider = (name || "gemini").toLowerCase();

  if (provider === "gemini") {
    return new GeminiProvider(config);
  }

  if (provider === "codex") {
    return new CodexProvider(config);
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
}
