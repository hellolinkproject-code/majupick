-- STEP 07-A 프로젝트 북마크(RFP 3.4.1, ERD_v1 §3.13). 새 테이블·인덱스·FK만 만들며 기존 행은 바꾸지 않는다.
-- PK (user_id, project_id): 같은 사용자가 같은 프로젝트를 두 번 저장할 수 없다(재전송·동시 요청에도 1행).
-- 프로젝트는 소프트 삭제만 하므로 삭제·취소된 프로젝트의 북마크 행은 남고, 조회할 때 공개 범위로 거른다.

-- CreateTable
CREATE TABLE "bookmarks" (
    "user_id" INTEGER NOT NULL,
    "project_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("user_id","project_id")
);

-- CreateIndex
CREATE INDEX "bookmarks_user_id_created_at_project_id_idx" ON "bookmarks"("user_id", "created_at" DESC, "project_id" DESC);

-- CreateIndex
CREATE INDEX "bookmarks_project_id_idx" ON "bookmarks"("project_id");

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
