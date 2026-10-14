-- STEP 06-B 지원자 선정(DEC-01). 프로젝트당 ACCEPTED 지원 1건(A-33, ERD_v1 §5 #2).
-- 수락 트랜잭션은 프로젝트 행을 FOR UPDATE로 잠그고 확인하지만, 잠금을 거치지 않는 쓰기가 생겨도
-- 두 번째 ACCEPTED는 이 인덱스가 막는다(위반 시 서버가 409로 바꾼다).
-- 인덱스만 추가하며 기존 행은 바꾸지 않는다. 적용 전 중복 ACCEPTED가 없음을 확인했다.

-- CreateIndex
CREATE UNIQUE INDEX "applications_one_accepted_per_project" ON "applications"("project_id") WHERE (status = 'ACCEPTED');
