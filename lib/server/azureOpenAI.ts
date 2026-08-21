import "server-only";

type AzureJsonRequest = {
  systemPrompt: string;
  userText: string;
  imageBase64?: string;
  imageMimeType?: string;
  maxTokens?: number;
  temperature?: number;
};

export class AzureOpenAIError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message);
  }
}

export async function requestAzureJson({
  systemPrompt,
  userText,
  imageBase64,
  imageMimeType = "image/jpeg",
  maxTokens = 1600,
  temperature = 0,
}: AzureJsonRequest): Promise<Record<string, unknown>> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, "");
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const baseDeployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const deployment = imageBase64
    ? process.env.AZURE_OPENAI_VISION_DEPLOYMENT || baseDeployment
    : process.env.AZURE_OPENAI_FAST_DEPLOYMENT || baseDeployment;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview";

  if (!endpoint || !apiKey || !deployment) {
    throw new AzureOpenAIError("Azure OpenAI 未配置（请检查 .env.local）", 500);
  }

  const userMessage = imageBase64
    ? {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:${imageMimeType};base64,${imageBase64}`,
              detail: "low",
            },
          },
          { type: "text", text: userText },
        ],
      }
    : { role: "user", content: userText };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch(
      `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": apiKey },
        body: JSON.stringify({
          messages: [
            { role: "system", content: systemPrompt },
            userMessage,
          ],
          temperature,
          top_p: 1,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error("Azure OpenAI error:", response.status, detail);
      throw new AzureOpenAIError(`AI 服务返回错误 (${response.status})`);
    }

    const payload = await response.json();
    const content = String(payload.choices?.[0]?.message?.content ?? "")
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();

    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]) as Record<string, unknown>;
        } catch {
          // Fall through to the user-facing format error.
        }
      }
      throw new AzureOpenAIError("AI 返回格式异常，请重试");
    }
  } catch (error: unknown) {
    if (error instanceof AzureOpenAIError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AzureOpenAIError("AI 请求超时，请重试", 504);
    }
    throw new AzureOpenAIError(
      "AI 服务调用失败：" + (error instanceof Error ? error.message : String(error))
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
