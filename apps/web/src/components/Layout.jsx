import { Link, Outlet } from 'react-router';

export function Layout() {
  return (
    <div className="layout">
      <header className="layout__header">
        <Link to="/" className="layout__logo">
          WorkBridge
        </Link>
        <span className="layout__badge">개발 환경</span>
      </header>
      <main className="layout__main">
        <Outlet />
      </main>
      <footer className="layout__footer">© WorkBridge</footer>
    </div>
  );
}
