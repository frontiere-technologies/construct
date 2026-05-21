import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()

  if (loading) return <div className="min-h-screen flex items-center justify-center">Caricamento...</div>
  if (!session) return <Navigate to="/login" replace />

  return <>{children}</>
}
