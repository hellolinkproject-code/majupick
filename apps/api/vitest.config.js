import { configDefaults, defineConfig } from 'vitest/config';

// 단위 테스트(npm run test). 실제 DB를 쓰는 test/db/는 vitest.db.config.js에서만 실행한다.
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    exclude: [...configDefaults.exclude, 'test/db/**'],
  },
});
