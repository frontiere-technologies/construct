import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={`bg-surface p-6 rounded-xl border border-border shadow-sm${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}
