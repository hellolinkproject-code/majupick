import { Layout } from '../components/Layout.jsx';
import { RequireAuth } from '../components/RequireAuth.jsx';
import { HomePage } from '../pages/HomePage.jsx';
import { LoginPage } from '../pages/LoginPage.jsx';
import { MyProfilePage } from '../pages/MyProfilePage.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';
import { OAuthCompletePage } from '../pages/OAuthCompletePage.jsx';
import { OAuthLinkPage } from '../pages/OAuthLinkPage.jsx';
import { SelectRolePage } from '../pages/SelectRolePage.jsx';
import { SignupPage } from '../pages/SignupPage.jsx';

export const routes = [
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: HomePage },
      { path: 'login', Component: LoginPage },
      { path: 'signup', Component: SignupPage },
      { path: 'oauth/complete', Component: OAuthCompletePage },
      { path: 'oauth/link', Component: OAuthLinkPage },
      { path: 'select-role', Component: SelectRolePage },
      {
        Component: RequireAuth,
        children: [{ path: 'me', Component: MyProfilePage }],
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
];
