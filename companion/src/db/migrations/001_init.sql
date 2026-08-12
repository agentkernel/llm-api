-- WorkBuddy companion 核心表结构
-- 设计原则：不存任何明文机器码/兑换码/密钥；敏感值只存 HMAC 或信封密文。

CREATE TABLE IF NOT EXISTS devices (
  id BIGSERIAL PRIMARY KEY,
  device_uuid UUID NOT NULL UNIQUE,
  machine_hmac TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'migrated')),
  sub2api_user_id BIGINT,
  sub2api_key_id BIGINT,
  current_group_id BIGINT,
  current_package_id BIGINT,
  -- 信封加密的隐藏用户凭据与设备 apiKey
  sealed_user_email TEXT,
  sealed_user_password TEXT,
  sealed_api_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_credentials (
  id BIGSERIAL PRIMARY KEY,
  device_id BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  token_hmac TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_device_credentials_device ON device_credentials(device_id, status);

CREATE TABLE IF NOT EXISTS packages (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cny NUMERIC(20, 2) NOT NULL CHECK (price_cny > 0),
  points NUMERIC(20, 2) NOT NULL CHECK (points > 0),
  target_group_id BIGINT NOT NULL,
  target_group_name TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_profiles (
  id BIGSERIAL PRIMARY KEY,
  model_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  vendor TEXT NOT NULL DEFAULT 'Custom',
  max_input_tokens INT,
  max_output_tokens INT,
  temperature NUMERIC(4, 2),
  supports_tool_call BOOLEAN NOT NULL DEFAULT false,
  supports_images BOOLEAN NOT NULL DEFAULT false,
  supports_reasoning BOOLEAN NOT NULL DEFAULT false,
  only_reasoning BOOLEAN NOT NULL DEFAULT false,
  use_custom_protocol BOOLEAN NOT NULL DEFAULT false,
  reasoning JSONB,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  catalog_version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS code_mappings (
  id BIGSERIAL PRIMARY KEY,
  code_hmac TEXT NOT NULL UNIQUE,
  sub2api_code_id BIGINT,
  package_id BIGINT REFERENCES packages(id),
  points NUMERIC(20, 2) NOT NULL,
  target_group_id BIGINT,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'redeemed', 'void')),
  redeemed_by_device BIGINT REFERENCES devices(id),
  redeemed_at TIMESTAMPTZ,
  batch_label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_code_mappings_status ON code_mappings(status);

CREATE TABLE IF NOT EXISTS purchase_links (
  id BIGSERIAL PRIMARY KEY,
  device_id BIGINT NOT NULL REFERENCES devices(id),
  package_id BIGINT NOT NULL REFERENCES packages(id),
  out_trade_no TEXT NOT NULL UNIQUE,
  sub2api_order_id BIGINT,
  payment_type TEXT NOT NULL,
  amount_cny NUMERIC(20, 2) NOT NULL,
  points NUMERIC(20, 2) NOT NULL,
  target_group_id BIGINT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'paid_pending_redeem', 'redeeming', 'redeemed', 'expired', 'cancelled', 'failed')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  redeemed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_purchase_links_device ON purchase_links(device_id, status);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  device_id BIGINT,
  actor TEXT NOT NULL DEFAULT 'system',
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_events_type_time ON audit_events(event_type, created_at);
