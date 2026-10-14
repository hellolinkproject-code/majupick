-- STEP 05-A 프로젝트 중복 등록 방지. 기존 행은 NULL로 남고(UNIQUE에서 NULL끼리는 충돌하지 않음) 데이터는 바뀌지 않는다.

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "idempotency_key" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "projects_client_id_idempotency_key_key" ON "projects"("client_id", "idempotency_key");
