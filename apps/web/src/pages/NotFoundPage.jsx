import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="not-found">
      <h1>404</h1>
      <p>요청한 페이지를 찾을 수 없습니다.</p>
      <Link to="/">홈으로 돌아가기</Link>
    </section>
  );
}
