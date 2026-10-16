-- STEP 08-B-1 AI 사용량·월간 예산 예약(D-117). 견적 결과 본문은 저장하지 않는다.
-- micro-USD(bigint): 1 USD = 1_000_000. 기존 행은 변경하지 않는다.

-- CreateEnum
CREATE TYPE "ai_usage_status" AS ENUM ('RESERVED', 'SETTLED', 'FAILED_CHARGED', 'RELEASED');

-- CreateTable
CREATE TABLE "ai_budget_months" (
    "month_key" CHAR(7) NOT NULL,
    "committed_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_budget_months_pkey" PRIMARY KEY ("month_key")
);

-- CreateTable
CREATE TABLE "ai_usage_ledger" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "month_key" CHAR(7) NOT NULL,
    "status" "ai_usage_status" NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "reserved_micro_usd" BIGINT NOT NULL,
    "settled_micro_usd" BIGINT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "provider_request_id" VARCHAR(128),
    "error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_usage_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_ledger_month_key_status_idx" ON "ai_usage_ledger"("month_key", "status");

-- CreateIndex
CREATE INDEX "ai_usage_ledger_user_id_created_at_idx" ON "ai_usage_ledger"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_usage_ledger_reserved_idx" ON "ai_usage_ledger"("status") WHERE status = 'RESERVED';

-- AddForeignKey
ALTER TABLE "ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Check: 예약·정산 금액은 음수 불가
ALTER TABLE "ai_budget_months" ADD CONSTRAINT "ai_budget_months_committed_nonneg"
  CHECK ("committed_micro_usd" >= 0);
ALTER TABLE "ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_reserved_positive"
  CHECK ("reserved_micro_usd" > 0);
ALTER TABLE "ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_settled_nonneg"
  CHECK ("settled_micro_usd" IS NULL OR "settled_micro_usd" >= 0);
