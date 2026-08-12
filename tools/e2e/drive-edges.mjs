// 边界场景：无效码、重复回调不重复入账、跨设备领取拒绝、未支付确认拒绝。
import { createHash } from "node:crypto";
import {
  SUB2API,
  COMPANION,
  EASYPAY_PID,
  EASYPAY_PKEY,
  req,
  log,
  check,
  summary,
  waitFor,
} from "./lib.mjs";

function easyPaySign(params, pkey) {
  const keys = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type" && params[k] !== "")
    .sort();
  return createHash("md5").update(keys.map((k) => `${k}=${params[k]}`).join("&") + pkey).digest("hex");
}

async function companion(path, opts) {
  return req(COMPANION, path, { ...opts, raw: true });
}

async function registerDevice(machineId) {
  const reg = await companion("/api/client/devices/register", {
    method: "POST",
    body: { machineId, appVersion: "0.1.0-e2e-edges" },
  });
  return reg.deviceToken;
}

async function sendNotify(outTradeNo, money) {
  const p = {
    pid: EASYPAY_PID,
    trade_no: `UP${Date.now()}${Math.floor(Math.random() * 1000)}`,
    out_trade_no: outTradeNo,
    type: "alipay",
    name: "edge",
    money: Number(money).toFixed(2),
    trade_status: "TRADE_SUCCESS",
  };
  p.sign = easyPaySign(p, EASYPAY_PKEY);
  p.sign_type = "MD5";
  const resp = await fetch(`${SUB2API}/api/v1/payment/webhook/easypay?${new URLSearchParams(p)}`, { method: "GET" });
  return (await resp.text()).toLowerCase();
}

async function main() {
  // ---- 无效兑换码被拒绝 ----
  const tokenA = await registerDevice(`win:edge-A-${Date.now()}`);
  try {
    await companion("/api/client/redeem", {
      method: "POST",
      headers: { "x-device-token": tokenA },
      body: { code: "deadbeefdeadbeefdeadbeefdeadbeef" },
    });
    check("invalid code rejected", false, "expected error");
  } catch (error) {
    check("invalid code rejected", error.status === 404 || error.status === 409, `${error.status}`);
  }

  // ---- 购买 + 重复回调不重复入账 ----
  const tokenB = await registerDevice(`win:edge-B-${Date.now()}`);
  const authB = { "x-device-token": tokenB };
  const pkgs = await companion("/api/client/packages", { headers: authB });
  const pkg = pkgs[0];
  const order = await companion("/api/client/purchase/orders", {
    method: "POST",
    headers: authB,
    body: { packageId: pkg.id, paymentType: "wxpay" },
  });
  log(`edge order ${order.outTradeNo}`);

  // 发三次相同回调
  await sendNotify(order.outTradeNo, pkg.points);
  await sendNotify(order.outTradeNo, pkg.points);
  await sendNotify(order.outTradeNo, pkg.points);

  const paid = await waitFor(async () => {
    const s = await companion(`/api/client/purchase/orders/${encodeURIComponent(order.outTradeNo)}`, { headers: authB });
    return s.status === "paid_pending_redeem" ? s : null;
  }, { label: "edge paid_pending_redeem", tries: 20 });
  check("duplicate webhooks -> single paid_pending_redeem", paid.status === "paid_pending_redeem");

  const stateBefore = await companion("/api/client/state", { headers: authB });
  check("no credit before confirm despite 3 webhooks", Number(stateBefore.points) === 0, JSON.stringify(stateBefore));

  const confirm = await companion(`/api/client/purchase/orders/${encodeURIComponent(order.outTradeNo)}/confirm`, {
    method: "POST",
    headers: authB,
  });
  check("edge confirm credits exactly package points", Number(confirm.points) === Number(pkg.points));

  const stateAfter = await companion("/api/client/state", { headers: authB });
  check("credited exactly once", Number(stateAfter.points) === Number(pkg.points), JSON.stringify(stateAfter));

  // 再确认一次不重复入账
  await companion(`/api/client/purchase/orders/${encodeURIComponent(order.outTradeNo)}/confirm`, { method: "POST", headers: authB });
  const stateAfter2 = await companion("/api/client/state", { headers: authB });
  check("re-confirm does not double credit", Number(stateAfter2.points) === Number(pkg.points), JSON.stringify(stateAfter2));

  // ---- 未支付订单确认被拒绝 ----
  const tokenC = await registerDevice(`win:edge-C-${Date.now()}`);
  const authC = { "x-device-token": tokenC };
  const order2 = await companion("/api/client/purchase/orders", {
    method: "POST",
    headers: authC,
    body: { packageId: pkg.id, paymentType: "alipay" },
  });
  try {
    await companion(`/api/client/purchase/orders/${encodeURIComponent(order2.outTradeNo)}/confirm`, {
      method: "POST",
      headers: authC,
    });
    check("unpaid confirm rejected", false, "expected error");
  } catch (error) {
    check("unpaid confirm rejected", error.status >= 400, `${error.status} ${error.message.slice(0, 80)}`);
  }

  // ---- 跨设备无法查看/确认他人订单 ----
  try {
    await companion(`/api/client/purchase/orders/${encodeURIComponent(order.outTradeNo)}`, { headers: authC });
    check("cross-device order lookup rejected", false, "expected 404");
  } catch (error) {
    check("cross-device order lookup rejected", error.status === 404, `${error.status}`);
  }

  summary("drive-edges");
}

main().catch((error) => {
  console.error("drive-edges FAILED:", error.message);
  if (error.body) console.error(JSON.stringify(error.body).slice(0, 500));
  process.exit(1);
});
