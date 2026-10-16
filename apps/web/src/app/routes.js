import { Layout } from '../components/Layout.jsx';
import { RequireAuth } from '../components/RequireAuth.jsx';
import { HomePage } from '../pages/HomePage.jsx';
import { LoginPage } from '../pages/LoginPage.jsx';
import { MyApplicationsPage } from '../pages/MyApplicationsPage.jsx';
import { MyBookmarksPage } from '../pages/MyBookmarksPage.jsx';
import { MyProfilePage } from '../pages/MyProfilePage.jsx';
import { ContractPreviewPage } from '../pages/ContractPreviewPage.jsx';
import { MyContractsPage } from '../pages/MyContractsPage.jsx';
import { MyPaymentsPage } from '../pages/MyPaymentsPage.jsx';
import { MyProjectsPage } from '../pages/MyProjectsPage.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';
import { NotificationsPage } from '../pages/NotificationsPage.jsx';
import { OAuthCompletePage } from '../pages/OAuthCompletePage.jsx';
import { OAuthLinkPage } from '../pages/OAuthLinkPage.jsx';
import { PaymentCheckoutPage } from '../pages/PaymentCheckoutPage.jsx';
import { PaymentDetailPage } from '../pages/PaymentDetailPage.jsx';
import { PaymentFailPage } from '../pages/PaymentFailPage.jsx';
import { PaymentSuccessPage } from '../pages/PaymentSuccessPage.jsx';
import { ProjectDetailPage } from '../pages/ProjectDetailPage.jsx';
import { ProjectEditPage } from '../pages/ProjectEditPage.jsx';
import { ProjectNewPage } from '../pages/ProjectNewPage.jsx';
import { ProjectSearchPage } from '../pages/ProjectSearchPage.jsx';
import { PublicProfilePage } from '../pages/PublicProfilePage.jsx';
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
      { path: 'projects', Component: ProjectSearchPage },
      { path: 'projects/:projectId', Component: ProjectDetailPage },
      { path: 'users/:userId', Component: PublicProfilePage },
      {
        Component: RequireAuth,
        children: [
          { path: 'me', Component: MyProfilePage },
          { path: 'me/projects', Component: MyProjectsPage },
          { path: 'me/applications', Component: MyApplicationsPage },
          { path: 'me/contracts', Component: MyContractsPage },
          { path: 'me/payments', Component: MyPaymentsPage },
          { path: 'me/bookmarks', Component: MyBookmarksPage },
          { path: 'contracts/:contractId', Component: ContractPreviewPage },
          { path: 'contracts/:contractId/pay', Component: PaymentCheckoutPage },
          { path: 'payments/success', Component: PaymentSuccessPage },
          { path: 'payments/fail', Component: PaymentFailPage },
          { path: 'payments/:paymentId', Component: PaymentDetailPage },
          { path: 'notifications', Component: NotificationsPage },
          { path: 'projects/new', Component: ProjectNewPage },
          { path: 'projects/:projectId/edit', Component: ProjectEditPage },
        ],
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
];
