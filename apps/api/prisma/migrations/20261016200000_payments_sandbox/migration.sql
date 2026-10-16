-- STEP 10-A: payments + 모의 에스크로 상태. DROP/TRUNCATE 없음.

CREATE TYPE "payment_status" AS ENUM ('READY', 'PAID', 'FAILED', 'REFUNDED');
CREATE TYPE "escrow_status" AS ENUM ('HELD', 'RELEASED');

CREATE TABLE "payments" (
  "id" SERIAL NOT NULL,
  "contract_id" INTEGER NOT NULL,
  "payer_id" INTEGER NOT NULL,
  "order_id" VARCHAR(64) NOT NULL,
  "payment_key" VARCHAR(200),
  "amount" BIGINT NOT NULL,
  "status" "payment_status" NOT NULL DEFAULT 'READY',
  "method" VARCHAR(30),
  "paid_at" TIMESTAMPTZ(3),
  "fail_code" VARCHAR(80),
  "fail_reason" VARCHAR(500),
  "escrow_status" "escrow_status",
  "fee_amount" BIGINT,
  "payout_amount" BIGINT,
  "released_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");
CREATE UNIQUE INDEX "payments_payment_key_key" ON "payments"("payment_key");
CREATE INDEX "payments_payer_id_created_at_idx" ON "payments"("payer_id", "created_at" DESC);
CREATE INDEX "payments_contract_id_idx" ON "payments"("contract_id");

-- 계약당 결제 성공 1건(B-09)
CREATE UNIQUE INDEX "payments_one_paid_per_contract"
  ON "payments"("contract_id")
  WHERE "status" = 'PAID';

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_fee_nonneg" CHECK ("fee_amount" IS NULL OR "fee_amount" >= 0);
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_payout_nonneg" CHECK ("payout_amount" IS NULL OR "payout_amount" >= 0);
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_paid_fields"
  CHECK (
    "status" <> 'PAID'
    OR (
      "payment_key" IS NOT NULL
      AND "paid_at" IS NOT NULL
      AND "escrow_status" IS NOT NULL
    )
  );
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_released_sums"
  CHECK (
    "escrow_status" IS DISTINCT FROM 'RELEASED'
    OR (
      "fee_amount" IS NOT NULL
      AND "payout_amount" IS NOT NULL
      AND "fee_amount" + "payout_amount" = "amount"
    )
  );

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_payer_id_fkey"
  FOREIGN KEY ("payer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
