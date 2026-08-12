// 本地端到端测试用的假 OpenAI 兼容上游。
// 实现 /v1/models、/v1/chat/completions、/v1/responses，返回最小合法响应。
// 仅用于自测，不涉及任何真实模型。
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4790);
const MODELS = ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"];

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const path = url.pathname;
    if (req.method === "GET" && path.endsWith("/models")) {
      send(res, 200, {
        object: "list",
        data: MODELS.map((id) => ({ id, object: "model", owned_by: "fake" })),
      });
      return;
    }
    if (req.method === "POST" && path.endsWith("/chat/completions")) {
      let model = "gpt-5.6";
      try {
        model = JSON.parse(body).model ?? model;
      } catch {
        /* ignore */
      }
      send(res, 200, {
        id: `chatcmpl-fake-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "pong" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
      return;
    }
    if (req.method === "POST" && path.endsWith("/responses")) {
      let model = "gpt-5.6";
      try {
        model = JSON.parse(body).model ?? model;
      } catch {
        /* ignore */
      }
      send(res, 200, {
        id: `resp-fake-${Date.now()}`,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        model,
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "pong" }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
      return;
    }
    send(res, 404, { error: { message: `no route ${req.method} ${path}` } });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake openai listening on 127.0.0.1:${port}`);
});
