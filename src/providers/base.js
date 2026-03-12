export class AIProvider {
  constructor(config = {}) {
    this.config = config;
  }

  async generateTailoredResume() {
    throw new Error("generateTailoredResume() must be implemented by a provider");
  }

  async extractJobTarget() {
    return null;
  }
}
