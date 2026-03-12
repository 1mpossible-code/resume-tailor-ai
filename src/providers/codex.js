import { AIProvider } from "./base.js";

export class CodexProvider extends AIProvider {
  async generateTailoredResume() {
    throw new Error("Codex provider is not implemented yet. Switch AI_PROVIDER=gemini.");
  }
}
