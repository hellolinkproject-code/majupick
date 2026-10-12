import { Layout } from '../components/Layout.jsx';
import { RequireAuth } from '../components/RequireAuth.jsx';
import { HomePage } from '../pages/HomePage.jsx';
import { LoginPage } from '../pages/LoginPage.jsx';
import { MyProfilePage } from '../pages/MyProfilePage.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';
import { SignupPage } from '../pages/SignupPage.jsx';

export const routes = [
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: HomePage },
      { path: 'login', Component: LoginPage },
      { path: 'signup', Component: SignupPage },
      {
        Component: RequireAuth,
        children: [{ path: 'me', Component: MyProfilePage }],
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
];
