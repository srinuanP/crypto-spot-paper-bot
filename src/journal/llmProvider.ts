export type LlmProvider = {
  summarize(prompt: string): Promise<string>;
};

export class DisabledLlmProvider implements LlmProvider {
  async summarize(_prompt: string): Promise<string> {
    return 'LLM provider is disabled by default for this free-first project.';
  }
}
