import { getDashboardHtml } from './html';
import { dashboardScript } from './script';
import { dashboardStyles } from './styles';

export function getDashboardAsset(pathname: string): { contentType: string; body: string } | undefined {
  if (pathname === '/' || pathname === '/ui') {
    return {
      contentType: 'text/html; charset=utf-8',
      body: getDashboardHtml(),
    };
  }

  if (pathname === '/ui/app.js') {
    return {
      contentType: 'application/javascript; charset=utf-8',
      body: dashboardScript,
    };
  }

  if (pathname === '/ui/app.css') {
    return {
      contentType: 'text/css; charset=utf-8',
      body: dashboardStyles,
    };
  }

  return undefined;
}
