/**
 * Common OpenAI-compatible services, offered as starting points when an embedding or chat service is added.
 * The base URLs assume the backend runs in Docker and the service on the same computer (host.docker.internal);
 * outside Docker use localhost instead.
 */
export type ServicePreset = {
  id: string;
  /** Button text, e.g. "Ollama on this computer". */
  label: string;
  /** Suggested name for the new service. */
  name: string;
  baseUrl: string;
  apiKeyRequired: boolean;
  /** Which kinds of service the preset fits. */
  kinds: Array<"embedding" | "chat">;
};

export const SERVICE_PRESETS: readonly ServicePreset[] = [
  { id: "ollama", label: "Ollama on this computer", name: "Ollama", baseUrl: "http://host.docker.internal:11434/v1", apiKeyRequired: false, kinds: ["embedding", "chat"] },
  { id: "lmstudio", label: "LM Studio", name: "LM Studio", baseUrl: "http://host.docker.internal:1234/v1", apiKeyRequired: false, kinds: ["embedding", "chat"] },
  { id: "openai", label: "OpenAI", name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKeyRequired: true, kinds: ["embedding", "chat"] },
  { id: "openrouter", label: "OpenRouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKeyRequired: true, kinds: ["chat"] },
];
