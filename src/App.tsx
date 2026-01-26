import { useEffect, useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import { Loading } from './components/Loading';
import { Landing } from './pages/Landing';
import { Signup } from './pages/Signup';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { NewReport } from './pages/NewReport';
import { ReportView } from './pages/ReportView';
import { Billing } from './pages/Billing';
import { Settings } from './pages/Settings';
import { Tracker } from './pages/Tracker';

function App() {
  const { user, loading } = useAuth();
  const [route, setRoute] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(window.location.pathname);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a');

      if (link && link.href.startsWith(window.location.origin)) {
        e.preventDefault();
        const newPath = link.pathname;
        window.history.pushState({}, '', newPath);
        setRoute(newPath);
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  if (loading) {
    return <Loading />;
  }

  const publicRoutes = ['/', '/signup', '/login'];
  const isPublicRoute = publicRoutes.includes(route);

  if (!user && !isPublicRoute) {
    window.history.replaceState({}, '', '/login');
    return <Login />;
  }

  if (user && (route === '/signup' || route === '/login')) {
    window.history.replaceState({}, '', '/app');
    return <Dashboard />;
  }

  if (route === '/') {
    return <Landing />;
  }

  if (route === '/signup') {
    return <Signup />;
  }

  if (route === '/login') {
    return <Login />;
  }

  if (route === '/app') {
    return <Dashboard />;
  }

  if (route === '/app/new') {
    return <NewReport />;
  }

  if (route.startsWith('/app/reports/')) {
    const reportId = route.split('/').pop();
    return <ReportView reportId={reportId || ''} />;
  }

  if (route === '/app/billing') {
    return <Billing />;
  }

  if (route === '/app/settings') {
    return <Settings />;
  }

  if (route === '/app/tracker') {
    return <Tracker />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">404 - Page Not Found</h1>
        <a href="/app" className="text-teal-600 hover:text-teal-700 underline">
          Go to Dashboard
        </a>
      </div>
    </div>
  );
}

export default App;
