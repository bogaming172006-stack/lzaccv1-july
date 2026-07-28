import React from 'react';
import DatabaseBackupRestore from '../components/DatabaseBackupRestore';

export default function BackupRestorePage() {
  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto w-full pb-24 sm:pb-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Database Backup & Restore</h1>
        <p className="text-sm text-gray-500 mt-1">Manage USB flash drive backups and database restores</p>
      </div>

      <DatabaseBackupRestore />
    </div>
  );
}
