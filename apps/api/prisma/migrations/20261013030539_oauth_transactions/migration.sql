-- CreateEnum
CREATE TYPE "oauth_transaction_kind" AS ENUM ('LOGIN', 'LINK');

-- CreateTable
CREATE TABLE "oauth_transactions" (
    "id" SERIAL NOT NULL,
    "kind" "oauth_transaction_kind" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "code_verifier" VARCHAR(255),
    "nonce" VARCHAR(255),
    "return_to" VARCHAR(500),
    "provider_user_id" VARCHAR(255),
    "email" VARCHAR(255),
    "user_id" INTEGER,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_transactions_token_hash_key" ON "oauth_transactions"("token_hash");

-- CreateIndex
CREATE INDEX "oauth_transactions_expires_at_idx" ON "oauth_transactions"("expires_at");

-- AddForeignKey
ALTER TABLE "oauth_transactions" ADD CONSTRAINT "oauth_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
