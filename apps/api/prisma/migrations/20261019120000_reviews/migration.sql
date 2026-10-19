-- STEP 11 상호 리뷰 (ERD_v1 §3.11, B-15~B-19)
CREATE TABLE "reviews" (
  "id" SERIAL NOT NULL,
  "contract_id" INTEGER NOT NULL,
  "reviewer_id" INTEGER NOT NULL,
  "reviewee_id" INTEGER NOT NULL,
  "rating" SMALLINT NOT NULL,
  "content" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_reviewer_ne_reviewee" CHECK ("reviewer_id" <> "reviewee_id");

CREATE UNIQUE INDEX "reviews_contract_id_reviewer_id_key" ON "reviews"("contract_id", "reviewer_id");

CREATE INDEX "reviews_reviewee_id_created_at_idx" ON "reviews"("reviewee_id", "created_at" DESC);

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_reviewer_id_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_reviewee_id_fkey"
  FOREIGN KEY ("reviewee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
