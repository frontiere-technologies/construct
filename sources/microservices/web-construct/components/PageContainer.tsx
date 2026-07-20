import type { ReactNode } from 'react'

interface PageContainerProps {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

export function PageContainer({ title, subtitle, actions, children }: PageContainerProps) {
  return (
    <div className="max-w-8xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="text-foreground-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="bg-surface p-6 rounded-xl border border-border shadow-sm space-y-8">
        {children}
      </div>
    </div>
  )
}
