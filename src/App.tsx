// src/App.tsx
import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './components/chat/Login';
import { ChatDashboard } from './components/chat/ChatDashboard';
import { FloatingTabBar } from './components/layout/FloatingTabBar';

/**
 * Inner component — reads from AuthContext.
 * Splits the tree: unauthenticated users see Login, authenticated users see ChatDashboard.
 */
function AppRoutes() {
  const { authUser } = useAuth();
  return authUser ? <ChatDashboard /> : <Login />;
}

/**
 * Root App
 * Wraps the entire tree in AuthProvider so every child can read JWT state.
 */
export default function App() {
  return (
    <AuthProvider>
      <div className="h-screen w-full max-w-md mx-auto bg-slate-50 dark:bg-slate-900 shadow-2xl overflow-hidden flex flex-col relative transition-colors duration-300 md:max-w-none">
        <AppRoutes />
      </div>
    </AuthProvider>
  );
}