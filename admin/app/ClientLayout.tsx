'use client';
import { PermissionProvider } from './components/PermissionContext';
import JobsMonitor from './components/JobsMonitor';
import ApiAuth from './components/ApiAuth';
import './globals.css';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <PermissionProvider>
      <ApiAuth />
      {children}
      <JobsMonitor />
    </PermissionProvider>
  );
}
