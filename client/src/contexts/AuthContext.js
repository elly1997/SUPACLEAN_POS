import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import api from '../api/api';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [branch, setBranch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionToken, setSessionToken] = useState(localStorage.getItem('sessionToken'));
  const [selectedBranchId, setSelectedBranchIdState] = useState(() => {
    try {
      const s = localStorage.getItem('selectedBranchId');
      return s ? parseInt(s, 10) : null;
    } catch (_) { return null; }
  });
  const isLoggingInRef = useRef(false);
  const userRef = useRef(null);

  const setSelectedBranch = useCallback((branchId) => {
    const id = branchId == null ? null : (typeof branchId === 'number' ? branchId : parseInt(branchId, 10));
    setSelectedBranchIdState(Number.isNaN(id) ? null : id);
    if (id != null) localStorage.setItem('selectedBranchId', String(id));
    else localStorage.removeItem('selectedBranchId');
  }, []);

  const logout = useCallback(async () => {
    try {
      if (sessionToken) {
        await api.post('/auth/logout');
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setSessionToken(null);
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('sessionUser');
      localStorage.removeItem('selectedBranchId');
      setUser(null);
      setBranch(null);
      setSelectedBranchIdState(null);
      userRef.current = null;
    }
  }, [sessionToken]);

  const verifySession = useCallback(async () => {
    // Skip verification if we're in the middle of logging in
    if (isLoggingInRef.current) {
      console.log('⏸️ Skipping verifySession - login in progress');
      return;
    }

    // Skip if user is already set
    if (userRef.current) {
      console.log('⏸️ Skipping verifySession - user already set');
      setLoading(false);
      return;
    }

    try {
      console.log('🔍 Verifying session...');
      const response = await api.get('/auth/verify');
      if (response.data.valid) {
        console.log('✅ Session valid:', response.data.user.username);
        setUser(response.data.user);
        setBranch(response.data.user.branch);
        userRef.current = response.data.user;
        setLoading(false);
      } else {
        console.log('❌ Session invalid');
        logout();
      }
    } catch (error) {
      console.error('❌ Session verification failed:', error);
      // Only logout on 401, not on network errors
      if (!isLoggingInRef.current && error.response?.status === 401) {
        console.log('🔒 Logging out due to 401');
        logout();
      } else if (!isLoggingInRef.current) {
        // Network/offline: restore user from cache so app works offline
        try {
          const cached = localStorage.getItem('sessionUser');
          if (cached) {
            const parsed = JSON.parse(cached);
            setUser(parsed);
            setBranch(parsed.branch ?? null);
            userRef.current = parsed;
            console.log('📴 Offline mode: using cached user', parsed.username);
          }
        } catch (e) {
          console.warn('Could not restore cached user', e);
        }
        setLoading(false);
      }
    }
  }, [logout]);

  // Update ref when user changes
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Verify session when token is available (only on mount or when token changes)
  useEffect(() => {
    // Don't verify during login
    if (isLoggingInRef.current) {
      console.log('⏸️ useEffect: Skipping - login in progress');
      return;
    }
    
    // Use ref to check current user state (avoid stale closure)
    if (sessionToken && !userRef.current) {
      console.log('🔍 useEffect: Verifying session (token exists, no user)');
      verifySession();
    } else if (!sessionToken) {
      console.log('🚫 useEffect: No token, clearing state');
      setUser(null);
      setBranch(null);
      userRef.current = null;
      setLoading(false);
    } else if (userRef.current) {
      // User already set (e.g., from login), just ensure loading is false
      console.log('✅ useEffect: User already set, setting loading to false');
      setLoading(false);
    }
  }, [sessionToken]); // Remove verifySession from deps to prevent loops - use refs inside

  const login = async (username, password) => {
    // Set flag to prevent verifySession from running during login
    isLoggingInRef.current = true;
    setLoading(true);
    
    try {
      console.log('🔐 Attempting login for:', username);
      const response = await api.post('/auth/login', { username, password });
      console.log('✅ Login response:', response.data);
      
      if (response.data.success) {
        const token = response.data.sessionToken;
        const userData = response.data.user;
        
        console.log('✅ Login successful, setting user state...');
        
        // Set user and branch first (this updates userRef via useEffect)
        setUser(userData);
        setBranch(userData.branch);
        userRef.current = userData; // Update ref immediately to prevent verifySession from running
        
        // Set loading to false
        setLoading(false);
        
        // Set token and save to localStorage AFTER a small delay to ensure user state is set
        // This ensures the useEffect sees userRef.current as set when it checks
        setTimeout(() => {
          setSessionToken(token);
          localStorage.setItem('sessionToken', token);
          // Cache user for offline use (login requires online; after that app can run offline)
          try {
            localStorage.setItem('sessionUser', JSON.stringify(userData));
          } catch (e) {
            console.warn('Could not cache user for offline', e);
          }
          // Clear the flag after token is set and state has settled
          setTimeout(() => {
            console.log('✅ Login complete, clearing login flag');
            isLoggingInRef.current = false;
          }, 500);
        }, 100);
        
        return { success: true };
      } else {
        console.error('❌ Login failed - no success flag');
        isLoggingInRef.current = false;
        setLoading(false);
        return {
          success: false,
          error: response.data.error || 'Login failed'
        };
      }
    } catch (error) {
      console.error('❌ Login error:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status
      });

      isLoggingInRef.current = false;
      setLoading(false);

      if (error.isDatabaseUnreachable) {
        return { success: false, error: error.message, isDatabaseUnreachable: true };
      }
      if (error.response) {
        const msg = error.response.data?.error || error.response.data?.message;
        return {
          success: false,
          error: msg || `Server error: ${error.response.status} ${error.response.statusText || ''}`.trim()
        };
      }
      return {
        success: false,
        error: error.message || 'Login failed. Check your connection and try again.'
      };
    }
  };


  // Permission checking helpers
  const hasPermission = (permission) => {
    if (!user || !user.role) return false;
    
    const permissions = {
      admin: {
        canManageUsers: true,
        canManageBranches: true,
        canEditPrices: true,
        canViewAllBranches: true,
        canManageOrders: true,
        canCreateOrders: true,
        canViewReports: true,
        canManageCash: true,
        canManageCustomers: true,
        canManageExpenses: true,
        canViewDashboard: true,
      },
      manager: {
        canManageUsers: false,
        canManageBranches: false,
        canEditPrices: false,
        canViewAllBranches: false,
        canManageOrders: true,
        canCreateOrders: true,
        canViewReports: true,
        canManageCash: true,
        canManageCustomers: true,
        canManageExpenses: true,
        canViewDashboard: true,
      },
      cashier: {
        canManageUsers: false,
        canManageBranches: false,
        canEditPrices: false,
        canViewAllBranches: false,
        canManageOrders: false,
        canCreateOrders: true,
        canViewReports: false,
        canManageCash: true,
        canManageCustomers: false,
        canManageExpenses: false,
        canViewDashboard: true,
      },
      processor: {
        canManageUsers: false,
        canManageBranches: false,
        canEditPrices: false,
        canViewAllBranches: false,
        canManageOrders: true,
        canCreateOrders: false,
        canViewReports: false,
        canManageCash: false,
        canManageCustomers: false,
        canManageExpenses: false,
        canViewDashboard: true,
      }
    };
    
    return permissions[user.role]?.[permission] === true;
  };

  const value = {
    user,
    branch,
    loading,
    login,
    logout,
    verifySession,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    isManager: user?.role === 'manager',
    isCashier: user?.role === 'cashier',
    isProcessor: user?.role === 'processor',
    hasPermission,
    selectedBranchId: user?.role === 'admin' ? selectedBranchId : (user?.branchId ?? null),
    setSelectedBranch: user?.role === 'admin' ? setSelectedBranch : () => {}
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
