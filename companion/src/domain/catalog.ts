import { getPool } from "../db/pool.js";

/** 服务端模型能力目录（与 WorkBuddy models.json schema 对齐的字段命名）。 */
export interface ModelProfile {
  modelId: string;
  displayName: string;
  vendor: string;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  temperature: number | null;
  supportsToolCall: boolean;
  supportsImages: boolean;
  supportsReasoning: boolean;
  onlyReasoning: boolean;
  useCustomProtocol: boolean;
  reasoning: Record<string, unknown> | null;
  sortOrder: number;
  catalogVersion: number;
}

interface ModelProfileRow {
  model_id: string;
  display_name: string;
  vendor: string;
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  temperature: string | null;
  supports_tool_call: boolean;
  supports_images: boolean;
  supports_reasoning: boolean;
  only_reasoning: boolean;
  use_custom_protocol: boolean;
  reasoning: Record<string, unknown> | null;
  sort_order: number;
  catalog_version: number;
}

export async function listEnabledModelProfiles(): Promise<ModelProfile[]> {
  const result = await getPool().query<ModelProfileRow>(
    "SELECT * FROM model_profiles WHERE enabled = true ORDER BY sort_order, model_id",
  );
  return result.rows.map((row) => ({
    modelId: row.model_id,
    displayName: row.display_name,
    vendor: row.vendor,
    maxInputTokens: row.max_input_tokens,
    maxOutputTokens: row.max_output_tokens,
    temperature: row.temperature === null ? null : Number(row.temperature),
    supportsToolCall: row.supports_tool_call,
    supportsImages: row.supports_images,
    supportsReasoning: row.supports_reasoning,
    onlyReasoning: row.only_reasoning,
    useCustomProtocol: row.use_custom_protocol,
    reasoning: row.reasoning,
    sortOrder: row.sort_order,
    catalogVersion: row.catalog_version,
  }));
}
