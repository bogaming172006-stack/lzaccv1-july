import { db, handleFirestoreError, OperationType, runTransaction, doc } from '../firebase';
import { Transaction, Party, DailySummary, DashboardSummary, Balance, CacheVersions } from '../types';
import { format } from 'date-fns';

// Helper to update high-level DashboardSummary totals inside a transaction
function adjustDashboardSummaryNoRead(
  transaction: any,
  ledgerId: string,
  partyOldDue: number,
  partyNewDue: number,
  txCountChange: number,
  summarySnap: any
) {
  const summaryRef = doc(db, 'dashboard_summary', ledgerId);
  
  // Calculate change in Receivable/Payables
  let receivableDiff = 0;
  let payableDiff = 0;

  // Subtract old contribution
  if (partyOldDue > 0) {
    receivableDiff -= partyOldDue;
  } else if (partyOldDue < 0) {
    payableDiff -= Math.abs(partyOldDue);
  }

  // Add new contribution
  if (partyNewDue > 0) {
    receivableDiff += partyNewDue;
  } else if (partyNewDue < 0) {
    payableDiff += Math.abs(partyNewDue);
  }

  if (summarySnap.exists()) {
    const summary = summarySnap.data() as DashboardSummary;
    transaction.update(summaryRef, {
      totalReceivable: Math.max(0, (summary.totalReceivable || 0) + receivableDiff),
      totalPayable: Math.max(0, (summary.totalPayable || 0) + payableDiff),
      totalTransactions: Math.max(0, (summary.totalTransactions || 0) + txCountChange),
      lastUpdated: Date.now()
    });
  } else {
    // Default summary
    const newSummary: DashboardSummary = {
      id: ledgerId,
      ledgerId: ledgerId,
      totalReceivable: partyNewDue > 0 ? partyNewDue : 0,
      totalPayable: partyNewDue < 0 ? Math.abs(partyNewDue) : 0,
      totalTransactions: Math.max(0, txCountChange),
      totalParties: 1, // Assume at least this party exists
      lastUpdated: Date.now()
    };
    transaction.set(summaryRef, newSummary);
  }
}

// Helper to trigger remote cache invalidation
function bumpCacheVersion(transaction: any, ledgerId: string, updateFields: Partial<CacheVersions>) {
  const versionRef = doc(db, 'cache_versions', ledgerId);
  const dataToUpdate: any = {
    id: ledgerId,
    ledgerId: ledgerId,
  };
  if (updateFields.parties) dataToUpdate.parties = updateFields.parties;
  if (updateFields.products) dataToUpdate.products = updateFields.products;
  if (updateFields.settings) dataToUpdate.settings = updateFields.settings;
  if (updateFields.dashboard_summary) dataToUpdate.dashboard_summary = updateFields.dashboard_summary;
  if (updateFields.transactions) dataToUpdate.transactions = updateFields.transactions;
  if (updateFields.tracked_invoices) dataToUpdate.tracked_invoices = updateFields.tracked_invoices;
  
  transaction.set(versionRef, dataToUpdate, { merge: true });
}

export async function createTransaction(newTx: Transaction, party: Party) {
  try {
    await runTransaction(db, async (transaction) => {
      // 1. ALL READS FIRST
      const partyRef = doc(db, 'parties', party.id);
      const partyDoc = await transaction.get(partyRef);
      
      let pData = party;
      if (!partyDoc.exists()) {
        // Self-heal: If the party doesn't exist in the database (e.g. from local mode), write it first.
        transaction.set(partyRef, party);
      } else {
        pData = partyDoc.data() as Party;
      }

      const dateStr = format(new Date(newTx.timestamp), 'yyyy-MM-dd');
      const dailyRef = doc(db, 'daily_summaries', `${newTx.ledgerId}_${dateStr}`);
      const dailyDoc = await transaction.get(dailyRef);

      const summaryRef = doc(db, 'dashboard_summary', newTx.ledgerId);
      const summarySnap = await transaction.get(summaryRef);

      // 2. CALCULATE VALUES
      const balanceChange = newTx.type === 'DEBIT' ? newTx.amount : -newTx.amount;
      const newBalance = pData.currentDue + balanceChange;
      const newTotalDebit = (pData.totalDebit || 0) + (newTx.type === 'DEBIT' ? newTx.amount : 0);
      const newTotalCredit = (pData.totalCredit || 0) + (newTx.type === 'CREDIT' ? newTx.amount : 0);

      // Add running balance to the transaction itself
      const txWithBalance = {
        ...newTx,
        runningBalance: newBalance
      };

      // 3. ALL WRITES AFTER
      const txRef = doc(db, 'transactions', newTx.id);
      transaction.set(txRef, txWithBalance);
      
      // Update Party (pre-calculated total)
      transaction.update(partyRef, {
        currentDue: newBalance,
        totalDebit: newTotalDebit,
        totalCredit: newTotalCredit,
        lastTransaction: newTx.timestamp
      });

      // Update balances (Separate balance table)
      const balanceRef = doc(db, 'balances', party.id);
      const balanceData: Balance = {
        id: party.id,
        partyId: party.id,
        ledgerId: party.ledgerId,
        currentDue: newBalance,
        totalDebit: newTotalDebit,
        totalCredit: newTotalCredit,
        lastTransaction: newTx.timestamp
      };
      transaction.set(balanceRef, balanceData);

      // Update Daily Summary
      if (dailyDoc.exists()) {
        const dData = dailyDoc.data() as DailySummary;
        transaction.update(dailyRef, {
          totalDebit: dData.totalDebit + (newTx.type === 'DEBIT' ? newTx.amount : 0),
          totalCredit: dData.totalCredit + (newTx.type === 'CREDIT' ? newTx.amount : 0),
          transactionCount: dData.transactionCount + 1
        });
      } else {
        const newDaily: DailySummary = {
          id: `${newTx.ledgerId}_${dateStr}`,
          ledgerId: newTx.ledgerId,
          date: dateStr,
          totalDebit: newTx.type === 'DEBIT' ? newTx.amount : 0,
          totalCredit: newTx.type === 'CREDIT' ? newTx.amount : 0,
          transactionCount: 1
        };
        transaction.set(dailyRef, newDaily);
      }

      // Update Dashboard Summary O(1) reads/writes
      adjustDashboardSummaryNoRead(transaction, newTx.ledgerId, pData.currentDue, newBalance, 1, summarySnap);

      // Bump cache versions
      bumpCacheVersion(transaction, newTx.ledgerId, {
        parties: Date.now(),
        dashboard_summary: Date.now(),
        transactions: Date.now()
      });
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('database-synced'));
    }
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'createTransaction');
    return false;
  }
}

export async function editTransaction(
  txId: string,
  oldTx: Transaction,
  updatedTxFields: { amount: number; invoiceNo: string; notes: string },
  party: Party
) {
  try {
    await runTransaction(db, async (transaction) => {
      // 1. ALL READS FIRST
      const partyRef = doc(db, 'parties', party.id);
      const partySnap = await transaction.get(partyRef);
      
      let pData = party;
      if (!partySnap.exists()) {
        // Self-heal: If the party doesn't exist in the database (e.g. from local mode), write it first.
        transaction.set(partyRef, party);
      } else {
        pData = partySnap.data() as Party;
      }

      const dateStr = format(new Date(oldTx.timestamp), 'yyyy-MM-dd');
      const dailyRef = doc(db, 'daily_summaries', `${oldTx.ledgerId}_${dateStr}`);
      const dailySnap = await transaction.get(dailyRef);

      const summaryRef = doc(db, 'dashboard_summary', oldTx.ledgerId);
      const summarySnap = await transaction.get(summaryRef);

      // 2. CALCULATE VALUES
      // Reverse old amount
      const oldChange = oldTx.type === 'DEBIT' ? oldTx.amount : -oldTx.amount;
      const baseDue = pData.currentDue - oldChange;
      const baseDebit = (pData.totalDebit || 0) - (oldTx.type === 'DEBIT' ? oldTx.amount : 0);
      const baseCredit = (pData.totalCredit || 0) - (oldTx.type === 'CREDIT' ? oldTx.amount : 0);

      // Apply new amount
      const newChange = oldTx.type === 'DEBIT' ? updatedTxFields.amount : -updatedTxFields.amount;
      const newBalance = baseDue + newChange;
      const newTotalDebit = baseDebit + (oldTx.type === 'DEBIT' ? updatedTxFields.amount : 0);
      const newTotalCredit = baseCredit + (oldTx.type === 'CREDIT' ? updatedTxFields.amount : 0);

      // 3. ALL WRITES AFTER
      // Update transaction
      const txRef = doc(db, 'transactions', txId);
      transaction.update(txRef, {
        amount: updatedTxFields.amount,
        invoiceNo: updatedTxFields.invoiceNo,
        notes: updatedTxFields.notes,
        runningBalance: newBalance
      });

      // Update Party
      transaction.update(partyRef, {
        currentDue: newBalance,
        totalDebit: newTotalDebit,
        totalCredit: newTotalCredit,
        lastTransaction: Date.now()
      });

      // Update Balances
      const balanceRef = doc(db, 'balances', party.id);
      transaction.update(balanceRef, {
        currentDue: newBalance,
        totalDebit: newTotalDebit,
        totalCredit: newTotalCredit,
        lastTransaction: Date.now()
      });

      // Update Daily Summary
      if (dailySnap.exists()) {
        const dData = dailySnap.data() as DailySummary;
        const diffAmount = updatedTxFields.amount - oldTx.amount;
        transaction.update(dailyRef, {
          totalDebit: dData.totalDebit + (oldTx.type === 'DEBIT' ? diffAmount : 0),
          totalCredit: dData.totalCredit + (oldTx.type === 'CREDIT' ? diffAmount : 0)
        });
      }

      // Update Dashboard Summary O(1)
      adjustDashboardSummaryNoRead(transaction, oldTx.ledgerId, pData.currentDue, newBalance, 0, summarySnap);

      // Bump cache versions
      bumpCacheVersion(transaction, oldTx.ledgerId, {
        parties: Date.now(),
        dashboard_summary: Date.now(),
        transactions: Date.now()
      });
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('database-synced'));
    }
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `transactions/${txId}`);
    return false;
  }
}

export async function deleteTransaction(oldTx: Transaction, party: Party) {
  try {
    await runTransaction(db, async (transaction) => {
      // 1. ALL READS FIRST
      const partyRef = doc(db, 'parties', party.id);
      const partySnap = await transaction.get(partyRef);
      
      let pData = party;
      if (!partySnap.exists()) {
        // Self-heal: If the party doesn't exist in the database (e.g. from local mode), write it first.
        transaction.set(partyRef, party);
      } else {
        pData = partySnap.data() as Party;
      }

      const dateStr = format(new Date(oldTx.timestamp), 'yyyy-MM-dd');
      const dailyRef = doc(db, 'daily_summaries', `${oldTx.ledgerId}_${dateStr}`);
      const dailySnap = await transaction.get(dailyRef);

      const summaryRef = doc(db, 'dashboard_summary', oldTx.ledgerId);
      const summarySnap = await transaction.get(summaryRef);

      // 2. CALCULATE VALUES
      // Reverse transaction effect
      const change = oldTx.type === 'DEBIT' ? -oldTx.amount : oldTx.amount;
      const newBalance = pData.currentDue + change;
      const newTotalDebit = Math.max(0, (pData.totalDebit || 0) - (oldTx.type === 'DEBIT' ? oldTx.amount : 0));
      const newTotalCredit = Math.max(0, (pData.totalCredit || 0) - (oldTx.type === 'CREDIT' ? oldTx.amount : 0));

      // 3. ALL WRITES AFTER
      // Delete transaction
      const txRef = doc(db, 'transactions', oldTx.id);
      transaction.delete(txRef);

      // Update Party
      transaction.update(partyRef, {
        currentDue: newBalance,
        totalDebit: newTotalDebit,
        totalCredit: newTotalCredit,
        lastTransaction: Date.now()
      });

      // Update Balances
      const balanceRef = doc(db, 'balances', party.id);
      transaction.update(balanceRef, {
        currentDue: newBalance,
        totalDebit: newTotalDebit,
        totalCredit: newTotalCredit,
        lastTransaction: Date.now()
      });

      // Update Daily Summary
      if (dailySnap.exists()) {
        const dData = dailySnap.data() as DailySummary;
        transaction.update(dailyRef, {
          totalDebit: Math.max(0, dData.totalDebit - (oldTx.type === 'DEBIT' ? oldTx.amount : 0)),
          totalCredit: Math.max(0, dData.totalCredit - (oldTx.type === 'CREDIT' ? oldTx.amount : 0)),
          transactionCount: Math.max(0, dData.transactionCount - 1)
        });
      }

      // Update Dashboard Summary
      adjustDashboardSummaryNoRead(transaction, oldTx.ledgerId, pData.currentDue, newBalance, -1, summarySnap);

      // Bump cache versions
      bumpCacheVersion(transaction, oldTx.ledgerId, {
        parties: Date.now(),
        dashboard_summary: Date.now(),
        transactions: Date.now()
      });
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('database-synced'));
    }
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `transactions/${oldTx.id}`);
    return false;
  }
}

// Function to handle incremental updates to DashboardSummary party count
export async function updateDashboardPartiesCount(ledgerId: string, countChange: number) {
  try {
    await runTransaction(db, async (transaction) => {
      const summaryRef = doc(db, 'dashboard_summary', ledgerId);
      const summarySnap = await transaction.get(summaryRef);
      if (summarySnap.exists()) {
        const summary = summarySnap.data() as DashboardSummary;
        transaction.update(summaryRef, {
          totalParties: Math.max(0, (summary.totalParties || 0) + countChange)
        });
      } else {
        const newSummary: DashboardSummary = {
          id: ledgerId,
          ledgerId: ledgerId,
          totalReceivable: 0,
          totalPayable: 0,
          totalTransactions: 0,
          totalParties: Math.max(0, countChange)
        };
        transaction.set(summaryRef, newSummary);
      }
      
      // Bump cache versions
      bumpCacheVersion(transaction, ledgerId, {
        parties: Date.now(),
        dashboard_summary: Date.now()
      });
    });
  } catch (err) {
    console.error("Error updating parties count", err);
  }
}
