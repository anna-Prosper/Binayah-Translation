'use client';
import { PermissionProvider } from './components/PermissionContext';
import JobsMonitor from './components/JobsMonitor';
import './globals.css';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <PermissionProvider>
      {children}
      <JobsMonitor />
    </PermissionProvider>
  );
}
