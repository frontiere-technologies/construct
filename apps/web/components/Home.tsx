'use client'

import React from 'react'
import { usePathname } from 'next/navigation'

export const Home: React.FC = () => {
  const pathname = usePathname()

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 capitalize">
        {pathname === '/' ? 'Dashboard' : pathname.substring(1).replace('/', ' - ')}
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
          <h3 className="text-gray-500 text-sm font-medium mb-2">Total Users</h3>
          <p className="text-3xl font-bold">12,450</p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
          <h3 className="text-gray-500 text-sm font-medium mb-2">Active Sessions</h3>
          <p className="text-3xl font-bold">1,234</p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
          <h3 className="text-gray-500 text-sm font-medium mb-2">Revenue</h3>
          <p className="text-3xl font-bold">$45,678</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 min-h-[400px]">
        <h2 className="text-xl font-semibold mb-4">Content Area</h2>
        <p className="text-gray-600 dark:text-gray-400">
          This is a placeholder page for <strong>{pathname}</strong>.
          Navigate using the sidebar to see the active state change.
        </p>
        <p className="text-gray-600 dark:text-gray-400 mt-4">
          Go to the <strong>Admin Panel</strong> (bottom of sidebar) to configure the menu structure dynamically.
        </p>
      </div>
    </div>
  )
}
