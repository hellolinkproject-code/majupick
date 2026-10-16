import { configure } from '@testing-library/react';

// 세션 복원(POST /auth/refresh) + 첫 목록/상세 요청이 기본 1000ms를 넘기는 경우가 있다.
// STEP 08-A 재현: projectCancel '프로젝트 취소' 버튼 findBy가 부하 시 ~1.6s에 실패하고,
// 동일 시나리오를 3000ms로 기다리면 5/5 통과했다. 테스트 기준을 낮추지 않고 대기만 맞춘다.
configure({ asyncUtilTimeout: 3000 });
