import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import api from '../api/api';
import { getBranches } from '../api/api';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import OfflineIndicator from './OfflineIndicator';
import { isSoundEnabled, setSoundEnabled } from '../utils/sound';
import './Layout.css';

const Layout = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());
  const { theme, toggleTheme } = useTheme();
  const { user, branch, logout, isAdmin, hasPermission, selectedBranchId, setSelectedBranch } = useAuth();
  // On back online, OfflineIndicator runs sync; we do not re-verify session here (avoids logout on 401 on Collection/Branches etc.)
  const handleBackOnline = useCallback(() => {}, []);
  const branchId = branch?.id ?? user?.branchId;
  const [availableFeatures, setAvailableFeatures] = useState([]);
  const [branches, setBranches] = useState([]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = () => setIsMobile(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (branchId) {
      fetchBranchFeatures(branchId);
    } else if (isAdmin) {
      setAvailableFeatures(['all']); // Admin sees all; no branch feature filter
    } else {
      setAvailableFeatures([]); // Non-admin without branch: no features until loaded
    }
  }, [branchId, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    getBranches()
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res?.data) ? res.data : [];
        setBranches(list);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load branches:', err);
        setBranches([]);
      });
    return () => { cancelled = true; };
  }, [isAdmin]);

  const fetchBranchFeatures = async (branchId) => {
    try {
      const response = await api.get(`/branches/${branchId}/features`);
      // Accept both boolean (PostgreSQL) and 1/0 (SQLite) for is_enabled
      const enabledFeatures = (response.data || [])
        .filter(f => f.is_enabled === true || f.is_enabled === 1)
        .map(f => f.feature_key);
      // Fallback: if branch has no features configured (e.g. legacy branches), grant all so branch users see tabs
      setAvailableFeatures(enabledFeatures.length > 0 ? enabledFeatures : ['all']);
    } catch (error) {
      console.error('Error fetching branch features:', error);
      // On error for branch users: grant all so they can still use the app
      setAvailableFeatures(branchId ? ['all'] : []);
    }
  };

  const hasFeature = (featureKeyOrKeys) => {
    if (isAdmin || availableFeatures.includes('all')) return true;
    if (Array.isArray(featureKeyOrKeys)) {
      return featureKeyOrKeys.some(key => availableFeatures.includes(key));
    }
    return availableFeatures.includes(featureKeyOrKeys);
  };

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Base menu items by workflow group
  const menuGroups = [
    {
      label: null,
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: '📊', permission: 'canViewDashboard', feature: null },
      ]
    },
    {
      label: 'Counter',
      items: [
        { path: '/new-order', label: 'New Order', icon: '➕', permission: 'canCreateOrders', feature: 'new_order' },
        { path: '/collection', label: 'Collection', icon: '✅', permission: 'canManageOrders', feature: 'collection' },
      ]
    },
    {
      label: 'Orders & customers',
      items: [
        { path: '/orders', label: 'Orders', icon: '📋', permission: ['canCreateOrders', 'canManageOrders'], feature: ['new_order', 'order_processing'] },
        { path: '/customers', label: 'Customers', icon: '👥', permission: null, feature: 'customers' },
        { path: '/price-list', label: 'Price List', icon: '💰', permission: null, feature: 'price_list_view' },
        { path: '/monthly-billing', label: 'Monthly Billing', icon: '📄', permission: 'canCreateOrders', feature: 'new_order' },
      ]
    },
    {
      label: 'Money & reports',
      items: [
        { path: '/cash-management', label: 'Cash Management', icon: '💵', permission: 'canManageCash', feature: 'cash_management' },
        { path: '/expenses', label: 'Expenses', icon: '📝', permission: 'canManageExpenses', feature: 'expenses' },
        { path: '/reports', label: 'Reports', icon: '📈', permission: 'canViewReports', feature: 'reports_basic' },
      ]
    },
    {
      label: null,
      items: [
        { path: '/cleaning-services', label: 'Cleaning Services', icon: '🧹', feature: 'cleaning_services', permission: null },
      ]
    },
  ];

  const hasAnyPermission = (permOrPerms) => {
    if (!permOrPerms) return true;
    if (Array.isArray(permOrPerms)) return permOrPerms.some(p => hasPermission(p));
    return hasPermission(permOrPerms);
  };

  const filterItem = (item) => {
    if (isAdmin) return true;
    if (item.feature && !hasFeature(item.feature)) return false;
    if (item.permission && !hasAnyPermission(item.permission)) return false;
    return true;
  };

  const filteredGroups = menuGroups.map(grp => ({
    ...grp,
    items: grp.items.filter(filterItem),
  })).filter(grp => grp.items.length > 0);

  if (isAdmin) {
    filteredGroups.push({
      label: 'Admin',
      items: [
        { path: '/admin/branches', label: 'Branches', icon: '🏢', feature: 'admin' },
        { path: '/admin/banking', label: 'Banking', icon: '🏦', feature: 'admin' },
      ]
    });
  }

  return (
    <div className="layout">
      <OfflineIndicator onBackOnline={handleBackOnline} />
      {isMobile && mobileMenuOpen && (
        <button
          type="button"
          className="sidebar-overlay"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close menu"
        />
      )}
      <aside className={`sidebar ${(isMobile ? mobileMenuOpen : true) ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div className="logo-container">
            <img src="/supaclean-logo.svg" alt="SUPACLEAN Logo" className="logo" />
          </div>
          <h2>SUPACLEAN</h2>
          <p className="sidebar-subtitle">POS System</p>
          {isAdmin ? (
            <div className="branch-switcher">
              <label htmlFor="branch-select" className="branch-switcher-label">Branch</label>
              <select
                id="branch-select"
                className="branch-select"
                value={selectedBranchId ?? ''}
                onChange={(e) => setSelectedBranch(e.target.value === '' ? null : e.target.value)}
                title="Filter by branch"
              >
                <option value="">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          ) : branch ? (
            <p className="branch-badge">{branch.name}</p>
          ) : null}
          {user && (
            <p className="user-info">{user.fullName} ({user.role})</p>
          )}
        </div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {filteredGroups.map((group, idx) => (
            <div key={group.label || `group-${idx}`} className="nav-group">
              {group.label && (
                <div className="nav-group-label" aria-hidden="true">{group.label}</div>
              )}
              {group.items.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? '🌙' : '☀️'}
            <span>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
          </button>
          <button
            type="button"
            className={`theme-toggle sound-toggle ${soundOn ? 'on' : ''}`}
            onClick={() => {
              const next = !soundOn;
              setSoundEnabled(next);
              setSoundOn(next);
            }}
            title={soundOn ? 'Success sound on (click to turn off)' : 'Success sound off (click to turn on)'}
            aria-pressed={soundOn}
          >
            {soundOn ? '🔔' : '🔕'}
            <span>Sound {soundOn ? 'On' : 'Off'}</span>
          </button>
          <button 
            className="logout-button"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
            title="Logout"
          >
            🚪 Logout
          </button>
          <p className="business-info">Arusha, Tanzania</p>
        </div>
      </aside>
      <main className={`main-content ${(isMobile ? mobileMenuOpen : true) ? 'sidebar-open' : 'sidebar-closed'}`}>
        <button
          type="button"
          className="mobile-menu-btn"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Open menu"
        >
          ☰
        </button>
        <div className="content-wrapper">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
