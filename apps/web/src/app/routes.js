import { Layout } from '../components/Layout.jsx';
import { HomePage } from '../pages/HomePage.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';

export const routes = [
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: HomePage },
      { path: '*', Component: NotFoundPage },
    ],
  },
];
