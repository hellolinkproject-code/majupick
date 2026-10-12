import { configDefaults, defineConfig } from 'vitest/config';

// 단위 테스트(npm run test). 실제 DB를 쓰는 test/db/는 vitest.db.config.js에서만 실행한다.
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    exclude: [...configDefaults.exclude, 'test/db/**'],
    // 느린 Windows 환경에서 파일별 첫 supertest 요청이 기본 5초를 넘는 경우가 있다.
    testTimeout: 20_000,
  },
});
