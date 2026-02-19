import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NewOrder from './pages/NewOrder';
import Orders from './pages/Orders';
import Customers from './pages/Customers';
import Collection from './pages/Collection';
import Reports from './pages/Reports';
import PriceList from './pages/PriceList';
import CashManagement from './pages/CashManagement';
import Expenses from './pages/Expenses';
import AdminBranches from './pages/AdminBranches';
import AdminBanking from './pages/AdminBanking';
import MonthlyBilling from './pages/MonthlyBilling';
import CleaningServices from './pages/CleaningServices';
import Terms from './pages/Terms';
import './App.css';

class AppErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('App error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px 24px',
          maxWidth: '560px',
          margin: '40px auto',
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          color: 'var(--text-primary)',
          textAlign: 'center'
        }}>
          <h1 style={{ marginBottom: '16px', fontSize: '20px' }}>Something went wrong</h1>
          <p style={{ marginBottom: '20px', color: 'var(--text-secondary)' }}>
            The page could not load. Try refreshing. If it continues, check the browser console for errors.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px',
              background: 'var(--primary-color)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            Refresh page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontSize: '18px',
        color: 'var(--text-primary)',
        background: 'var(--bg-primary)'
      }}>
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppErrorBoundary>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/terms" element={<Terms />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Routes>
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/dashboard" element={<Dashboard />} />
                      <Route path="/new-order" element={<NewOrder />} />
                      <Route path="/orders" element={<Orders />} />
                      <Route path="/customers" element={<Customers />} />
                      <Route path="/collection" element={<Collection />} />
                      <Route path="/price-list" element={<PriceList />} />
                      <Route path="/cash-management" element={<CashManagement />} />
                      <Route path="/expenses" element={<Expenses />} />
                      <Route path="/reports" element={<Reports />} />
                      <Route path="/monthly-billing" element={<MonthlyBilling />} />
                      <Route path="/cleaning-services" element={<CleaningServices />} />
                      <Route path="/admin/branches" element={<AdminBranches />} />
                      <Route path="/admin/banking" element={<AdminBanking />} />
                    </Routes>
                  </Layout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </Router>
        </AppErrorBoundary>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
