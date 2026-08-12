// 本地端到端测试用的假 EasyPay 上游：响应 mapi.php 下单请求。
// 用法: node server.mjs [port]
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4780);
let counter = 0;

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname.endsWith("/mapi.php")) {
      counter += 1;
      const params = new URLSearchParams(body);
      const outTradeNo = params.get("out_trade_no") ?? "";
      const payload = {
        code: 1,
        msg: "success",
        trade_no: `FAKE${Date.now()}${counter}`,
        payurl: "",
        qrcode: `https://fake-easypay.local/pay/${outTradeNo}`,
      };
      console.log(`[fake-easypay] order ${outTradeNo} -> ${payload.trade_no}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake easypay listening on 127.0.0.1:${port}`);
});
