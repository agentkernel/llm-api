import { useCallback, useEffect, useState } from "react";
import type { ModelsFetchResult, TestResult } from "@shared/types";
import { wb, errorText } from "../api";
import { Modal, useToast } from "../ui";

export function ModelsPage({ onApplied }: { onApplied: () => void }) {
  const [data, setData] = useState<ModelsFetchResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [applied, setApplied] = useState<{ written: number; configPath: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const toast = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    setApplied(null);
    try {
      const result = await wb.fetchModels();
      setData(result);
      setSelected(new Set(result.models.map((model) => model.modelId)));
      setTestResults({});
    } catch (error) {
      toast.push("error", errorText(error));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = (modelId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const apply = async () => {
    setConfirming(false);
    setApplying(true);
    try {
      const result = await wb.applyModels([...selected]);
      setApplied({ written: result.written, configPath: result.configPath });
      toast.push("success", `已写入 ${result.written} 个模型，WorkBuddy 将自动加载`);
      onApplied();
    } catch (error) {
      toast.push("error", errorText(error));
    } finally {
      setApplying(false);
    }
  };

  const runTest = async (modelId: string) => {
    setTesting(modelId);
    try {
      const result = await wb.testModel(modelId);
      setTestResults((current) => ({ ...current, [modelId]: result }));
    } catch (error) {
      setTestResults((current) => ({
        ...current,
        [modelId]: { ok: false, latencyMs: null, message: errorText(error) },
      }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div>
      <div className="page-title">模型配置</div>
      <div className="page-subtitle">
        勾选要启用的模型，应用会备份并全量替换 WorkBuddy 的 models.json
      </div>

      <div className="card">
        <div className="row">
          <div className="hint">
            {loading
              ? "正在获取可用模型…"
              : data
                ? `可配置 ${data.models.length} 个模型` +
                  (data.hiddenCount > 0 ? `（另有 ${data.hiddenCount} 个待管理员适配后可用）` : "")
                : "获取失败"}
          </div>
          <button className="btn" disabled={loading} onClick={() => void refresh()}>
            刷新
          </button>
        </div>
      </div>

      {data && data.models.length > 0 && (
        <div className="stack" style={{ marginTop: 12 }}>
          {data.models.map((model) => {
            const checked = selected.has(model.modelId);
            const test = testResults[model.modelId];
            return (
              <div
                key={model.modelId}
                className={`check-row ${checked ? "checked" : ""}`}
                onClick={() => toggle(model.modelId)}
              >
                <input type="checkbox" checked={checked} readOnly />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>
                    {model.displayName} <span className="hint mono">{model.modelId}</span>
                  </div>
                  <div style={{ marginTop: 2 }}>
                    {model.supportsToolCall && <span className="tag">工具调用</span>}
                    {model.supportsImages && <span className="tag">图片</span>}
                    {model.supportsReasoning && <span className="tag accent">推理</span>}
                    {model.maxInputTokens && (
                      <span className="tag">{Math.round(model.maxInputTokens / 1024)}K 上下文</span>
                    )}
                  </div>
                  {test && (
                    <div className="hint" style={{ color: test.ok ? "var(--accent)" : "var(--danger)" }}>
                      {test.ok ? `连通正常（${test.latencyMs}ms）` : `测试失败：${test.message}`}
                    </div>
                  )}
                </div>
                <button
                  className="btn btn-ghost"
                  disabled={testing !== null}
                  onClick={(event) => {
                    event.stopPropagation();
                    void runTest(model.modelId);
                  }}
                >
                  {testing === model.modelId ? "测试中…" : "连通测试"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {data && data.models.length === 0 && !loading && (
        <div className="card empty" style={{ marginTop: 12 }}>
          当前没有可配置的模型，请确认已兑换套餐或联系管理员适配模型
        </div>
      )}

      <div className="card row" style={{ marginTop: 12, position: "sticky", bottom: 12 }}>
        <div className="hint">
          已选 {selected.size} 个模型 · 连通测试会消耗极少量积分
          {applied && (
            <span style={{ color: "var(--accent)" }}>
              {" "}
              · 上次写入 {applied.written} 个模型
            </span>
          )}
        </div>
        <button
          className="btn btn-primary"
          disabled={applying || loading || selected.size === 0}
          onClick={() => setConfirming(true)}
        >
          {applying ? "写入中…" : "备份并应用"}
        </button>
      </div>

      {confirming && (
        <Modal
          title="确认替换 models.json？"
          onClose={() => setConfirming(false)}
          actions={
            <>
              <button className="btn" onClick={() => setConfirming(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={() => void apply()}>
                备份并替换
              </button>
            </>
          }
        >
          将写入 {selected.size} 个模型并<strong>全量替换</strong>现有配置
          （原文件会先加密备份，可在设置中恢复）。WorkBuddy 会自动热加载；
          进行中的会话首条消息若报 ECONNRESET，重发一次即可。
        </Modal>
      )}
    </div>
  );
}
