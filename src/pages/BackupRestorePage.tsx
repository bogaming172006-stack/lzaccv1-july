import React from 'react';
import DatabaseBackupRestore from '../components/DatabaseBackupRestore';
import { useAuth } from '../AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Badge from '../components/ui/Badge';

export default function BackupRestorePage() {
  const { currentUser } = useAuth();

  if (!currentUser?.isAdmin) {
    return (
      <div className="p-8 text-center text-rose-600 font-semibold">
        Access Denied. Only Executive Admin users can access Backup & Restore.
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto w-full pb-24 sm:pb-8 space-y-6">
      <PageHeader
        title="Backup, Recovery & Data Archives"
        subtitle="Manage secure USB flash drive backups, offline snapshots, and SQLite database restore operations"
      />

      <DatabaseBackupRestore />
    </div>
  );
}
