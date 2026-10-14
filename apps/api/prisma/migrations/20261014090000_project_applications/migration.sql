-- STEP 06-A 프로젝트 지원(applications). 새 enum 2개와 테이블 1개만 추가한다.
-- 기존 테이블·행·제약은 바꾸지 않는다(DROP·데이터 삭제 없음).

-- CreateEnum
CREATE TYPE "application_status" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "reject_reason" AS ENUM ('MANUAL', 'OTHER_ACCEPTED', 'PROJECT_CLOSED', 'NEGOTIATION_FAILED', 'PROJECT_CANCELLED', 'PROJECT_DELETED');

-- CreateTable
CREATE TABLE "applications" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "freelancer_id" INTEGER NOT NULL,
    "cover_letter" TEXT NOT NULL,
    "proposed_amount" BIGINT NOT NULL,
    "proposed_duration_days" INTEGER NOT NULL,
    "status" "application_status" NOT NULL DEFAULT 'PENDING',
    "reject_reason" "reject_reason",
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "applications_project_id_status_idx" ON "applications"("project_id", "status");

-- CreateIndex
CREATE INDEX "applications_freelancer_id_created_at_idx" ON "applications"("freelancer_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "applications_project_id_freelancer_id_key" ON "applications"("project_id", "freelancer_id");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint (Prisma 스키마로 표현할 수 없는 ERD_v1 §3.8 CHECK 제약, 수동 추가)
ALTER TABLE "applications" ADD CONSTRAINT "applications_proposed_amount_check" CHECK ("proposed_amount" > 0);

-- AddCheckConstraint
ALTER TABLE "applications" ADD CONSTRAINT "applications_proposed_duration_days_check" CHECK ("proposed_duration_days" > 0);

-- AddCheckConstraint
-- 거절 사유는 거절된 지원에만 있고, 거절된 지원에는 반드시 있다(D-49).
ALTER TABLE "applications" ADD CONSTRAINT "applications_reject_reason_check" CHECK (("status" = 'REJECTED') = ("reject_reason" IS NOT NULL));

-- AddCheckConstraint
-- 처리 시각은 수락·거절된 지원에만 있고, 처리된 지원에는 반드시 있다.
ALTER TABLE "applications" ADD CONSTRAINT "applications_decided_at_check" CHECK (("status" = 'PENDING') = ("decided_at" IS NULL));
