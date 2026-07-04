import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Signup from './pages/Signup';
import RequireAuth from './RequireAuth';
import IDE from './IDE';
import { getToken } from './auth';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={getToken() ? '/ide' : '/login'} replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route
        path="/ide"
        element={
          <RequireAuth>
            <IDE />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
