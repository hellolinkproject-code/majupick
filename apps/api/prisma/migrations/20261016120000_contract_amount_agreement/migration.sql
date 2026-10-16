-- STEP 09-A: 합의 금액 제안(offer_*) + 계약서(contracts). 전자서명·결제는 이후 단계.

CREATE TYPE "offer_status" AS ENUM ('PENDING', 'AGREED', 'DECLINED');
CREATE TYPE "contract_status" AS ENUM (
  'SIGNATURE_PENDING',
  'SIGNED',
  'IN_PROGRESS',
  'DELIVERY_REQUESTED',
  'COMPLETED',
  'CANCELLED'
);

ALTER TABLE "applications"
  ADD COLUMN "offer_amount" BIGINT,
  ADD COLUMN "offer_status" "offer_status",
  ADD COLUMN "offered_at" TIMESTAMPTZ(3),
  ADD COLUMN "offer_responded_at" TIMESTAMPTZ(3);

ALTER TABLE "applications"
  ADD CONSTRAINT "applications_offer_amount_positive"
  CHECK ("offer_amount" IS NULL OR "offer_amount" > 0);

-- 제안이 있으면 금액·시각이 함께 있어야 한다. 선정(ACCEPTED)만으로는 제안을 강제하지 않는다(D-118).
ALTER TABLE "applications"
  ADD CONSTRAINT "applications_offer_fields_consistent"
  CHECK (
    ("offer_status" IS NULL AND "offer_amount" IS NULL AND "offered_at" IS NULL AND "offer_responded_at" IS NULL)
    OR (
      "offer_status" IS NOT NULL
      AND "offer_amount" IS NOT NULL
      AND "offered_at" IS NOT NULL
      AND (
        ("offer_status" = 'PENDING' AND "offer_responded_at" IS NULL)
        OR ("offer_status" IN ('AGREED', 'DECLINED') AND "offer_responded_at" IS NOT NULL)
      )
    )
  );

CREATE TABLE "contracts" (
  "id" SERIAL NOT NULL,
  "project_id" INTEGER NOT NULL,
  "application_id" INTEGER NOT NULL,
  "client_id" INTEGER NOT NULL,
  "freelancer_id" INTEGER NOT NULL,
  "project_title" VARCHAR(100) NOT NULL,
  "agreed_amount" BIGINT NOT NULL,
  "duration_days" INTEGER NOT NULL,
  "terms" TEXT NOT NULL,
  "parties_snapshot" JSONB NOT NULL,
  "status" "contract_status" NOT NULL DEFAULT 'SIGNATURE_PENDING',
  "client_signed_at" TIMESTAMPTZ(3),
  "freelancer_signed_at" TIMESTAMPTZ(3),
  "signed_at" TIMESTAMPTZ(3),
  "work_started_at" TIMESTAMPTZ(3),
  "delivery_note" TEXT,
  "delivery_url" VARCHAR(500),
  "delivery_requested_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contracts_project_id_key" ON "contracts"("project_id");
CREATE UNIQUE INDEX "contracts_application_id_key" ON "contracts"("application_id");
CREATE INDEX "contracts_client_id_created_at_idx" ON "contracts"("client_id", "created_at" DESC);
CREATE INDEX "contracts_freelancer_id_created_at_idx" ON "contracts"("freelancer_id", "created_at" DESC);

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_agreed_amount_positive" CHECK ("agreed_amount" > 0);
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_duration_days_positive" CHECK ("duration_days" > 0);
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_parties_distinct" CHECK ("client_id" <> "freelancer_id");
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_signed_at_requires_both"
  CHECK (
    "signed_at" IS NULL
    OR ("client_signed_at" IS NOT NULL AND "freelancer_signed_at" IS NOT NULL)
  );

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_freelancer_id_fkey"
  FOREIGN KEY ("freelancer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
