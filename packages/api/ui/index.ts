import { getDashboardHtml } from './html';
import { dashboardScript } from './script';
import { dashboardStyles } from './styles';

function isDashboardDocumentPath(pathname: string): boolean {
  return pathname === '/' ||
    pathname === '/ui' ||
    pathname === '/logs' ||
    /^\/task\/[^/]+$/.test(pathname) ||
    /^\/task\/[^/]+\/artifacts$/.test(pathname) ||
    /^\/run\/[^/]+$/.test(pathname) ||
    /^\/artifact\/[^/]+$/.test(pathname);
}

export function getDashboardAsset(pathname: string): { contentType: string; body: string } | undefined {
  if (isDashboardDocumentPath(pathname)) {
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
