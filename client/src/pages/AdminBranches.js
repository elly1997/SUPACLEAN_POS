import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/useToast';
import { 
  getBranches, createBranch, updateBranch,
  getUsers, createUser, updateUser, deleteUser,
  getBranchFeatures, updateBranchFeatures,
  checkServerConnection
} from '../api/api';
import './AdminBranches.css';

const AdminBranches = () => {
  const { isAdmin } = useAuth();
  const { showToast, ToastContainer } = useToast();
  const [branches, setBranches] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('branches'); // 'branches' or 'users'
  
  // Branch form state
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const [branchForm, setBranchForm] = useState({
    name: '',
    code: '',
    branch_type: 'collection',
    address: '',
    phone: '',
    manager_name: '',
    is_active: true
  });

  // User form state
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    full_name: '',
    role: 'manager',
    branch_id: '',
    is_active: true
  });

  // Branch features/privileges state
  const [showFeaturesModal, setShowFeaturesModal] = useState(false);
  const [editingBranchFeatures, setEditingBranchFeatures] = useState(null);
  const [branchFeatures, setBranchFeatures] = useState([]);
  
  // Available features list
  const availableFeatures = [
    { key: 'new_order', label: 'New Order', description: 'Create new orders' },
    { key: 'order_processing', label: 'Order Processing', description: 'Process and update order status' },
    { key: 'collection', label: 'Collection', description: 'Collect completed orders' },
    { key: 'customers', label: 'Customer Management', description: 'Manage customer database' },
    { key: 'price_list_view', label: 'Price List View', description: 'View prices (read-only)' },
    { key: 'cash_management', label: 'Cash Management', description: 'Manage daily cash and payments' },
    { key: 'expenses', label: 'Expenses', description: 'Record and manage expenses' },
    { key: 'reports_basic', label: 'Basic Reports', description: 'View sales and transaction reports' },
    { key: 'bank_deposits', label: 'Bank Deposits', description: 'Record bank deposits' },
    { key: 'service_management', label: 'Service Management', description: 'Manage services and items' },
    { key: 'cleaning_services', label: 'Cleaning Services', description: 'Quotations, invoices, payments and expenses for cleaning (independent from laundry)' }
  ];

  useEffect(() => {
    if (!isAdmin) {
      showToast('Access denied. Admin privileges required.', 'error');
      return;
    }
    
    // Check server connection first
    checkServerConnection().then(result => {
      if (!result.connected) {
        showToast('Cannot connect to server. Please ensure the server is running on port 5000.', 'error');
      }
    });
    
    loadData();
  }, [isAdmin, showToast]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Check server connection first
      const connectionCheck = await checkServerConnection();
      if (!connectionCheck.connected) {
        showToast('Cannot connect to server. Please ensure the server is running on port 5000.', 'error');
        setLoading(false);
        return;
      }
      
      const [branchesRes, usersRes] = await Promise.all([
        getBranches(),
        getUsers()
      ]);
      setBranches(branchesRes.data || []);
      setUsers(usersRes.data || []);
    } catch (error) {
      console.error('Error loading data:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
      
      // Better error messages
      if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('Network Error')) {
        showToast('Cannot connect to server. Please ensure the server is running on port 5000.', 'error');
      } else {
        showToast('Error loading data: ' + errorMsg, 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  // Branch handlers
  const handleCreateBranch = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Check server connection
    const connectionCheck = await checkServerConnection();
    if (!connectionCheck.connected) {
      showToast('Cannot connect to server. Please ensure the server is running on port 5000.', 'error');
      return;
    }
    
    try {
      await createBranch(branchForm);
      showToast('Branch created successfully', 'success');
      setShowBranchForm(false);
      resetBranchForm();
      loadData();
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
      
      if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('Network Error')) {
        showToast('Cannot connect to server. Please ensure the server is running on port 5000.', 'error');
      } else {
        showToast('Error creating branch: ' + errorMsg, 'error');
      }
      console.error('Create branch error:', error);
    }
  };

  const handleUpdateBranch = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Check server connection
    const connectionCheck = await checkServerConnection();
    if (!connectionCheck.connected) {
      showToast('Cannot connect to server. Please ensure the server is running on port 5000.', 'error');
      return;
    }
    
    try {
      await updateBranch(editingBranch.id, branchForm);
      showToast('Branch updated successfully', 'success');
      setShowBranchForm(false);
      setEditingBranch(null);
      resetBranchForm();
      loadData();
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
      
      if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('Network Error')) {
        showToast('Cannot connect to server. Please ensure the server is running on port 5000.', 'error');
      } else {
        showToast('Error updating branch: ' + errorMsg, 'error');
      }
      console.error('Update branch error:', error);
    }
  };

  const handleEditBranch = (branch) => {
    setEditingBranch(branch);
    setBranchForm({
      name: branch.name || '',
      code: branch.code || '',
      branch_type: branch.branch_type || 'collection',
      address: branch.address || '',
      phone: branch.phone || '',
      manager_name: branch.manager_name || '',
      is_active: branch.is_active !== undefined ? branch.is_active : true
    });
    setShowBranchForm(true);
  };

  const resetBranchForm = () => {
    setBranchForm({
      name: '',
      code: '',
      branch_type: 'collection',
      address: '',
      phone: '',
      manager_name: '',
      is_active: true
    });
    setEditingBranch(null);
  };

  // User handlers
  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!userForm.password) {
      showToast('Password is required for new users', 'error');
      return;
    }
    try {
      await createUser({
        ...userForm,
        branch_id: userForm.branch_id || null
      });
      showToast('User created successfully', 'success');
      setShowUserForm(false);
      resetUserForm();
      loadData();
    } catch (error) {
      showToast('Error creating user: ' + (error.response?.data?.error || error.message), 'error');
    }
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    try {
      const updateData = { ...userForm };
      if (!updateData.password) {
        delete updateData.password; // Don't update password if empty
      }
      await updateUser(editingUser.id, updateData);
      showToast('User updated successfully', 'success');
      setShowUserForm(false);
      setEditingUser(null);
      resetUserForm();
      loadData();
    } catch (error) {
      showToast('Error updating user: ' + (error.response?.data?.error || error.message), 'error');
    }
  };

  const handleEditUser = (user) => {
    setEditingUser(user);
    setUserForm({
      username: user.username || '',
      password: '', // Don't show password
      full_name: user.full_name || '',
      role: user.role || 'manager',
      branch_id: user.branch_id || '',
      is_active: user.is_active !== undefined ? user.is_active : true
    });
    setShowUserForm(true);
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Are you sure you want to deactivate this user?')) {
      return;
    }
    try {
      await deleteUser(userId);
      showToast('User deactivated successfully', 'success');
      loadData();
    } catch (error) {
      showToast('Error deactivating user: ' + (error.response?.data?.error || error.message), 'error');
    }
  };

  const resetUserForm = () => {
    setUserForm({
      username: '',
      password: '',
      full_name: '',
      role: 'manager',
      branch_id: '',
      is_active: true
    });
    setEditingUser(null);
  };

  // Branch features/privileges handlers
  const handleManageFeatures = async (branch) => {
    try {
      setEditingBranchFeatures(branch);
      const res = await getBranchFeatures(branch.id);
      const features = res.data || [];
      
      // Create a map of all features with their enabled status
      const featuresMap = {};
      features.forEach(f => {
        featuresMap[f.feature_key] = f.is_enabled;
      });
      
      // Merge with available features to ensure all are shown
      const mergedFeatures = availableFeatures.map(af => ({
        feature_key: af.key,
        is_enabled: featuresMap[af.key] !== undefined ? featuresMap[af.key] : false
      }));
      
      setBranchFeatures(mergedFeatures);
      setShowFeaturesModal(true);
    } catch (error) {
      showToast('Error loading branch features: ' + (error.response?.data?.error || error.message), 'error');
    }
  };

  const handleToggleFeature = (featureKey) => {
    setBranchFeatures(prev => prev.map(f => 
      f.feature_key === featureKey 
        ? { ...f, is_enabled: !f.is_enabled }
        : f
    ));
  };

  const handleSaveFeatures = async (e) => {
    e.preventDefault();
    try {
      await updateBranchFeatures(editingBranchFeatures.id, branchFeatures);
      showToast('Branch privileges updated successfully', 'success');
      setShowFeaturesModal(false);
      setEditingBranchFeatures(null);
      setBranchFeatures([]);
    } catch (error) {
      showToast('Error updating branch features: ' + (error.response?.data?.error || error.message), 'error');
    }
  };

  if (!isAdmin) {
    return (
      <div className="admin-branches">
        <div className="access-denied">
          <h2>Access Denied</h2>
          <p>You need administrator privileges to access this page.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="admin-branches">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="admin-branches">
      <ToastContainer />
      <div className="admin-header">
        <h1>Admin Dashboard</h1>
        <p>Manage branches and users</p>
      </div>

      <div className="admin-tabs">
        <button 
          className={activeTab === 'branches' ? 'active' : ''}
          onClick={() => setActiveTab('branches')}
        >
          🏢 Branches ({branches.length})
        </button>
        <button 
          className={activeTab === 'users' ? 'active' : ''}
          onClick={() => setActiveTab('users')}
        >
          👥 Users ({users.length})
        </button>
      </div>

      {activeTab === 'branches' && (
        <div className="branches-section">
          <div className="section-header">
            <h2>Branches</h2>
            <button 
              className="btn-primary"
              onClick={() => {
                resetBranchForm();
                setShowBranchForm(true);
              }}
            >
              ➕ Add Branch
            </button>
          </div>

          {showBranchForm && (
            <div className="modal-overlay" onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowBranchForm(false);
                resetBranchForm();
              }
            }}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>{editingBranch ? '✏️ Edit Branch' : '➕ Create New Branch'}</h3>
                  {editingBranch && (
                    <div className="modal-subtitle">{editingBranch.name}</div>
                  )}
                </div>
                <form onSubmit={editingBranch ? handleUpdateBranch : handleCreateBranch}>
                  <div className="form-group">
                    <label>Name *</label>
                    <input
                      type="text"
                      value={branchForm.name}
                      onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Code *</label>
                    <input
                      type="text"
                      value={branchForm.code}
                      onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value.toUpperCase() })}
                      required
                      placeholder="e.g., AR02"
                    />
                  </div>
                  <div className="form-group">
                    <label>Type *</label>
                    <select
                      value={branchForm.branch_type}
                      onChange={(e) => setBranchForm({ ...branchForm, branch_type: e.target.value })}
                      required
                    >
                      <option value="collection">Collection Unit</option>
                      <option value="workshop">Workshop</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Address</label>
                    <input
                      type="text"
                      value={branchForm.address}
                      onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input
                      type="text"
                      value={branchForm.phone}
                      onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Manager Name</label>
                    <input
                      type="text"
                      value={branchForm.manager_name}
                      onChange={(e) => setBranchForm({ ...branchForm, manager_name: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>
                      <input
                        type="checkbox"
                        checked={branchForm.is_active}
                        onChange={(e) => setBranchForm({ ...branchForm, is_active: e.target.checked })}
                      />
                      {' '}Active
                    </label>
                  </div>
                  <div className="form-actions">
                    <button 
                      type="button" 
                      className="btn-secondary"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowBranchForm(false);
                        resetBranchForm();
                      }}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn-primary">
                      {editingBranch ? 'Update Branch' : 'Create Branch'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div className="branches-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Type</th>
                  <th>Manager</th>
                  <th>Address</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {branches.map(branch => (
                  <tr key={branch.id}>
                    <td><strong>{branch.name}</strong></td>
                    <td>{branch.code}</td>
                    <td>
                      <span className={`branch-badge ${branch.branch_type}`}>
                        {branch.branch_type === 'collection' ? 'Collection' : 'Workshop'}
                      </span>
                    </td>
                    <td>{branch.manager_name || '—'}</td>
                    <td>{branch.address || '—'}</td>
                    <td>{branch.phone || '—'}</td>
                    <td>
                      <span className={branch.is_active ? 'status-active' : 'status-inactive'}>
                        {branch.is_active ? '✅ Active' : '❌ Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="branch-actions-inline">
                        <button
                          type="button"
                          className="btn-edit-small"
                          onClick={() => handleEditBranch(branch)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-small-inline"
                          onClick={() => handleManageFeatures(branch)}
                          title="Manage Branch Privileges"
                        >
                          Privileges
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="users-section">
          <div className="section-header">
            <h2>Users</h2>
            <button 
              className="btn-primary"
              onClick={() => {
                resetUserForm();
                setShowUserForm(true);
              }}
            >
              ➕ Add User
            </button>
          </div>

          {showUserForm && (
            <div className="modal-overlay" onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowUserForm(false);
                resetUserForm();
              }
            }}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>{editingUser ? '✏️ Edit User' : '➕ Create New User'}</h3>
                  {editingUser && (
                    <div className="modal-subtitle">{editingUser.full_name}</div>
                  )}
                </div>
                <form onSubmit={editingUser ? handleUpdateUser : handleCreateUser}>
                  <div className="form-group">
                    <label>Username *</label>
                    <input
                      type="text"
                      value={userForm.username}
                      onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                      required
                      disabled={!!editingUser}
                    />
                  </div>
                  <div className="form-group">
                    <label>Password {editingUser ? '(leave blank to keep current)' : '*'}</label>
                    <input
                      type="password"
                      value={userForm.password}
                      onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                      required={!editingUser}
                    />
                  </div>
                  <div className="form-group">
                    <label>Full Name *</label>
                    <input
                      type="text"
                      value={userForm.full_name}
                      onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Role *</label>
                    <select
                      value={userForm.role}
                      onChange={(e) => setUserForm({ ...userForm, role: e.target.value, branch_id: e.target.value === 'admin' ? '' : userForm.branch_id })}
                      required
                    >
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                      <option value="cashier">Cashier</option>
                      <option value="processor">Processor</option>
                    </select>
                  </div>
                  {userForm.role !== 'admin' && (
                    <div className="form-group">
                      <label>Branch *</label>
                      <select
                        value={userForm.branch_id}
                        onChange={(e) => setUserForm({ ...userForm, branch_id: e.target.value })}
                        required={userForm.role !== 'admin'}
                      >
                        <option value="">Select a branch</option>
                        {branches.map(branch => (
                          <option key={branch.id} value={branch.id}>
                            {branch.code} - {branch.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="form-group">
                    <label>
                      <input
                        type="checkbox"
                        checked={userForm.is_active}
                        onChange={(e) => setUserForm({ ...userForm, is_active: e.target.checked })}
                      />
                      {' '}Active
                    </label>
                  </div>
                  <div className="form-actions">
                    <button 
                      type="button" 
                      className="btn-secondary"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowUserForm(false);
                        resetUserForm();
                      }}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn-primary">
                      {editingUser ? 'Update User' : 'Create User'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div className="users-table">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Full Name</th>
                  <th>Role</th>
                  <th>Branch</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id}>
                    <td>{user.username}</td>
                    <td>{user.full_name}</td>
                    <td>
                      <span className={`role-badge ${user.role}`}>
                        {user.role}
                      </span>
                    </td>
                    <td>{user.branch_name ? `${user.branch_code} - ${user.branch_name}` : 'N/A (Admin)'}</td>
                    <td>
                      <span className={user.is_active ? 'status-active' : 'status-inactive'}>
                        {user.is_active ? '✅ Active' : '❌ Inactive'}
                      </span>
                    </td>
                    <td>{user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}</td>
                    <td>
                      <button 
                        className="btn-edit-small"
                        onClick={() => handleEditUser(user)}
                      >
                        Edit
                      </button>
                      {user.is_active && (
                        <button 
                          className="btn-delete-small"
                          onClick={() => handleDeleteUser(user.id)}
                        >
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Branch Features/Privileges Modal */}
      {showFeaturesModal && editingBranchFeatures && (
        <div className="modal-overlay" onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowFeaturesModal(false);
            setEditingBranchFeatures(null);
            setBranchFeatures([]);
          }
        }}>
          <div className="modal-content features-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🔐 Manage Privileges - {editingBranchFeatures.name}</h3>
              <div className="modal-subtitle">Enable or disable features for this branch</div>
            </div>
            <form onSubmit={handleSaveFeatures}>
              <div className="features-list">
                {availableFeatures.map(feature => {
                  const featureState = branchFeatures.find(f => f.feature_key === feature.key);
                  const isEnabled = featureState?.is_enabled || false;
                  
                  return (
                    <div key={feature.key} className="feature-item">
                      <label className="feature-label">
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={() => handleToggleFeature(feature.key)}
                        />
                        <div className="feature-info">
                          <span className="feature-name">{feature.label}</span>
                          <span className="feature-description">{feature.description}</span>
                        </div>
                      </label>
                    </div>
                  );
                })}
              </div>
              <div className="form-actions">
                <button 
                  type="button" 
                  className="btn-secondary"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowFeaturesModal(false);
                    setEditingBranchFeatures(null);
                    setBranchFeatures([]);
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  💾 Save Privileges
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminBranches;
