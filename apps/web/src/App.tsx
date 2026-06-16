import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MenuProvider } from './context/MenuContext';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { AdminMenuBuilder } from './pages/AdminMenuBuilder';
import { AdminTheme } from './pages/AdminTheme';
import { Login } from './pages/Login';

export default function App() {
  return (
    <AuthProvider>
      <MenuProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Home />} />
              <Route path="admin" element={<Navigate to="/admin/menu-builder" replace />} />
              <Route path="admin/menu-builder" element={<AdminMenuBuilder />} />
              <Route path="admin/theme" element={<AdminTheme />} />
              <Route path="*" element={<Home />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </MenuProvider>
    </AuthProvider>
  );
}
