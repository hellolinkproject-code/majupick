-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('CLIENT', 'FREELANCER');

-- CreateEnum
CREATE TYPE "oauth_provider" AS ENUM ('GOOGLE');

-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('SCHEDULED', 'RECRUITING', 'CLOSED', 'CONTRACTING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "project_category" AS ENUM ('WEB', 'MOBILE', 'DESIGN', 'MARKETING', 'DATA_AI', 'PLANNING', 'ETC');

-- CreateEnum
CREATE TYPE "business_field" AS ENUM ('IT', 'COMMERCE', 'EDUCATION', 'FINANCE', 'HEALTHCARE', 'MEDIA', 'MANUFACTURING', 'ETC');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255),
    "name" VARCHAR(50) NOT NULL,
    "role" "user_role",
    "profile_image_url" VARCHAR(500),
    "bio" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "provider" "oauth_provider" NOT NULL,
    "provider_user_id" VARCHAR(255) NOT NULL,
    "email_at_link" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_profiles" (
    "user_id" INTEGER NOT NULL,
    "company_name" VARCHAR(100),
    "business_field" "business_field",
    "business_field_etc" VARCHAR(100),
    "website_url" VARCHAR(500),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "freelancer_profiles" (
    "user_id" INTEGER NOT NULL,
    "main_category" "project_category",
    "career_years" INTEGER,
    "hourly_rate" BIGINT,
    "portfolio_url" VARCHAR(500),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freelancer_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "tech_stacks" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "normalized_name" VARCHAR(50) NOT NULL,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tech_stacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freelancer_tech_stacks" (
    "freelancer_id" INTEGER NOT NULL,
    "tech_stack_id" INTEGER NOT NULL,

    CONSTRAINT "freelancer_tech_stacks_pkey" PRIMARY KEY ("freelancer_id","tech_stack_id")
);

-- CreateTable
CREATE TABLE "project_tech_stacks" (
    "project_id" INTEGER NOT NULL,
    "tech_stack_id" INTEGER NOT NULL,

    CONSTRAINT "project_tech_stacks_pkey" PRIMARY KEY ("project_id","tech_stack_id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "category" "project_category" NOT NULL,
    "recruit_start_date" DATE,
    "recruit_end_date" DATE NOT NULL,
    "budget" BIGINT NOT NULL,
    "status" "project_status" NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_provider_provider_user_id_key" ON "social_accounts"("provider", "provider_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_user_id_provider_key" ON "social_accounts"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tech_stacks_normalized_name_key" ON "tech_stacks"("normalized_name");

-- CreateIndex
CREATE INDEX "freelancer_tech_stacks_tech_stack_id_idx" ON "freelancer_tech_stacks"("tech_stack_id");

-- CreateIndex
CREATE INDEX "project_tech_stacks_tech_stack_id_idx" ON "project_tech_stacks"("tech_stack_id");

-- CreateIndex
CREATE INDEX "projects_status_recruit_end_date_active_idx" ON "projects"("status", "recruit_end_date") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "projects_status_recruit_start_date_active_idx" ON "projects"("status", "recruit_start_date") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "projects_category_idx" ON "projects"("category");

-- CreateIndex
CREATE INDEX "projects_created_at_idx" ON "projects"("created_at" DESC);

-- CreateIndex
CREATE INDEX "projects_budget_idx" ON "projects"("budget" DESC);

-- CreateIndex
CREATE INDEX "projects_client_id_created_at_idx" ON "projects"("client_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_profiles" ADD CONSTRAINT "freelancer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_stacks" ADD CONSTRAINT "tech_stacks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_tech_stacks" ADD CONSTRAINT "freelancer_tech_stacks_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancer_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_tech_stacks" ADD CONSTRAINT "freelancer_tech_stacks_tech_stack_id_fkey" FOREIGN KEY ("tech_stack_id") REFERENCES "tech_stacks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tech_stacks" ADD CONSTRAINT "project_tech_stacks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tech_stacks" ADD CONSTRAINT "project_tech_stacks_tech_stack_id_fkey" FOREIGN KEY ("tech_stack_id") REFERENCES "tech_stacks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint (Prisma 스키마로 표현할 수 없는 ERD_v1 §3 CHECK 제약, 수동 추가)
-- business_field가 NULL이면 `= 'ETC'` 비교 결과도 NULL이 되어 CHECK를 통과하므로 IS NOT DISTINCT FROM을 쓴다.
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_business_field_etc_check" CHECK ("business_field_etc" IS NULL OR "business_field" IS NOT DISTINCT FROM 'ETC');

-- AddCheckConstraint
ALTER TABLE "freelancer_profiles" ADD CONSTRAINT "freelancer_profiles_career_years_check" CHECK ("career_years" >= 0);

-- AddCheckConstraint
ALTER TABLE "freelancer_profiles" ADD CONSTRAINT "freelancer_profiles_hourly_rate_check" CHECK ("hourly_rate" > 0);

-- AddCheckConstraint
ALTER TABLE "projects" ADD CONSTRAINT "projects_budget_check" CHECK ("budget" > 0);

-- AddCheckConstraint
ALTER TABLE "projects" ADD CONSTRAINT "projects_recruit_dates_check" CHECK ("recruit_start_date" IS NULL OR "recruit_start_date" <= "recruit_end_date");
