import { Layout } from '../components/Layout.jsx';
import { RequireAuth } from '../components/RequireAuth.jsx';
import { HomePage } from '../pages/HomePage.jsx';
import { LoginPage } from '../pages/LoginPage.jsx';
import { MyProfilePage } from '../pages/MyProfilePage.jsx';
import { MyProjectsPage } from '../pages/MyProjectsPage.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';
import { OAuthCompletePage } from '../pages/OAuthCompletePage.jsx';
import { OAuthLinkPage } from '../pages/OAuthLinkPage.jsx';
import { ProjectDetailPage } from '../pages/ProjectDetailPage.jsx';
import { ProjectEditPage } from '../pages/ProjectEditPage.jsx';
import { ProjectNewPage } from '../pages/ProjectNewPage.jsx';
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
      { path: 'projects/:projectId', Component: ProjectDetailPage },
      {
        Component: RequireAuth,
        children: [
          { path: 'me', Component: MyProfilePage },
          { path: 'me/projects', Component: MyProjectsPage },
          { path: 'projects/new', Component: ProjectNewPage },
          { path: 'projects/:projectId/edit', Component: ProjectEditPage },
        ],
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
];
