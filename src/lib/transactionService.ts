import { db, handleFirestoreError, OperationType, runTransaction, doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where } from '../firebase';
import { Transaction, Party, DailySummary, DashboardSummary, Balance, CacheVersions } from '../types';
import { setCacheItem } from './idbCache';
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

export interface EditTransactionFields {
  amount: number;
  type?: 'DEBIT' | 'CREDIT';
  timestamp?: number;
  invoiceNo?: string;
  notes?: string;
}

export async function editTransaction(
  txId: string,
  oldTx: Transaction,
  updatedTxFields: EditTransactionFields,
  party: Party
) {
  try {
    const newType = updatedTxFields.type || oldTx.type;
    const newAmount = updatedTxFields.amount;
    const newTimestamp = updatedTxFields.timestamp || oldTx.timestamp;
    const newInvoiceNo = updatedTxFields.invoiceNo !== undefined ? updatedTxFields.invoiceNo : (oldTx.invoiceNo || '');
    const newNotes = updatedTxFields.notes !== undefined ? updatedTxFields.notes : (oldTx.notes || '');

    // 1. Update the transaction document first
    const txRef = doc(db, 'transactions', txId);
    await updateDoc(txRef, {
      amount: newAmount,
      type: newType,
      timestamp: newTimestamp,
      invoiceNo: newInvoiceNo,
      notes: newNotes
    });

    // 2. Perform accurate chronological recalculation of all running balances for this party
    await recalculatePartyBalance(party.id, oldTx.ledgerId);

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
    // 1. Delete transaction doc
    const txRef = doc(db, 'transactions', oldTx.id);
    await updateDoc(txRef, { isDeleted: true }); // safety
    const { deleteDoc } = await import('../firebase');
    await deleteDoc(txRef);

    // 2. Perform accurate recalculation of all running balances and party due
    await recalculatePartyBalance(party.id, oldTx.ledgerId);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('database-synced'));
    }
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `transactions/${oldTx.id}`);
    return false;
  }
}

// Function to recalculate and fix calculations for a single party from scratch
export async function recalculatePartyBalance(partyId: string, ledgerId: string): Promise<{
  success: boolean;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  currentDue: number;
  transactionCount: number;
  error?: string;
}> {
  try {
    const partyRef = doc(db, 'parties', partyId);
    const partySnap = await getDoc(partyRef);
    if (!partySnap.exists()) {
      return { success: false, openingBalance: 0, totalDebit: 0, totalCredit: 0, currentDue: 0, transactionCount: 0, error: 'Party not found' };
    }
    const partyData = partySnap.data() as Party;
    const openingBal = partyData.openingBalance || 0;

    // Fetch all transactions for this party
    const txQuery = query(
      collection(db, 'transactions'),
      where('partyId', '==', partyId)
    );
    const txSnap = await getDocs(txQuery);
    const txs: Transaction[] = [];
    txSnap.forEach(d => {
      const data = d.data() as Transaction;
      if (data && data.id) {
        txs.push(data);
      }
    });

    // Sort chronologically ascending
    txs.sort((a, b) => a.timestamp - b.timestamp);

    let runningBal = openingBal;
    let sumDebit = 0;
    let sumCredit = 0;
    let latestTs = partyData.lastTransaction || Date.now();

    for (const tx of txs) {
      const isDebit = tx.type === 'DEBIT';
      if (isDebit) {
        sumDebit += tx.amount;
        runningBal += tx.amount;
      } else {
        sumCredit += tx.amount;
        runningBal -= tx.amount;
      }
      latestTs = Math.max(latestTs, tx.timestamp);

      // Update transaction runningBalance if changed
      const tRef = doc(db, 'transactions', tx.id);
      await updateDoc(tRef, { runningBalance: runningBal });
      await setCacheItem<Transaction>('transactions', { ...tx, runningBalance: runningBal });
    }

    const updatedParty: Party = {
      ...partyData,
      currentDue: runningBal,
      totalDebit: sumDebit,
      totalCredit: sumCredit,
      lastTransaction: txs.length > 0 ? latestTs : partyData.lastTransaction
    };

    await updateDoc(partyRef, {
      currentDue: runningBal,
      totalDebit: sumDebit,
      totalCredit: sumCredit,
      lastTransaction: updatedParty.lastTransaction
    });

    const balRef = doc(db, 'balances', partyId);
    await setDoc(balRef, {
      id: partyId,
      partyId,
      ledgerId,
      currentDue: runningBal,
      totalDebit: sumDebit,
      totalCredit: sumCredit,
      lastTransaction: updatedParty.lastTransaction
    }, { merge: true });

    await setCacheItem<Party>('parties', updatedParty);
    await setCacheItem<Balance>('balances', {
      id: partyId,
      partyId,
      ledgerId,
      currentDue: runningBal,
      totalDebit: sumDebit,
      totalCredit: sumCredit,
      lastTransaction: updatedParty.lastTransaction
    });

    // Recalculate dashboard summary
    await recalculateDashboardSummary(ledgerId);

    return {
      success: true,
      openingBalance: openingBal,
      totalDebit: sumDebit,
      totalCredit: sumCredit,
      currentDue: runningBal,
      transactionCount: txs.length
    };
  } catch (err: any) {
    console.error('Failed to recalculate party balance:', err);
    return {
      success: false,
      openingBalance: 0,
      totalDebit: 0,
      totalCredit: 0,
      currentDue: 0,
      transactionCount: 0,
      error: err.message || String(err)
    };
  }
}

// Function to recalculate dashboard summary totals for a ledger
export async function recalculateDashboardSummary(ledgerId: string): Promise<DashboardSummary | null> {
  try {
    const partiesQuery = query(
      collection(db, 'parties'),
      where('ledgerId', '==', ledgerId)
    );
    const partiesSnap = await getDocs(partiesQuery);
    let totalReceivable = 0;
    let totalPayable = 0;
    let partyCount = 0;

    partiesSnap.forEach(d => {
      const p = d.data() as Party;
      partyCount++;
      if (p.currentDue > 0) {
        totalReceivable += p.currentDue;
      } else if (p.currentDue < 0) {
        totalPayable += Math.abs(p.currentDue);
      }
    });

    const txQuery = query(
      collection(db, 'transactions'),
      where('ledgerId', '==', ledgerId)
    );
    const txSnap = await getDocs(txQuery);
    const totalTransactions = txSnap.size;

    const summaryRef = doc(db, 'dashboard_summary', ledgerId);
    const summaryData: DashboardSummary = {
      id: ledgerId,
      ledgerId,
      totalReceivable,
      totalPayable,
      totalTransactions,
      totalParties: partyCount,
      lastUpdated: Date.now()
    };

    await setDoc(summaryRef, summaryData, { merge: true });
    await setCacheItem<DashboardSummary>('dashboard_summary', summaryData);

    const versionRef = doc(db, 'cache_versions', ledgerId);
    await setDoc(versionRef, {
      id: ledgerId,
      ledgerId,
      parties: Date.now(),
      dashboard_summary: Date.now(),
      transactions: Date.now()
    }, { merge: true });

    return summaryData;
  } catch (err) {
    console.error('Failed to recalculate dashboard summary:', err);
    return null;
  }
}

// Function to recalculate all parties and summary across an entire ledger
export async function recalculateLedgerBalances(ledgerId: string): Promise<{
  success: boolean;
  partiesFixed: number;
  totalTransactions: number;
  totalReceivable: number;
  totalPayable: number;
  error?: string;
}> {
  try {
    const partiesQuery = query(
      collection(db, 'parties'),
      where('ledgerId', '==', ledgerId)
    );
    const partiesSnap = await getDocs(partiesQuery);
    let partiesFixed = 0;
    let totalTransactions = 0;

    for (const pDoc of partiesSnap.docs) {
      const p = pDoc.data() as Party;
      const res = await recalculatePartyBalance(p.id, ledgerId);
      if (res.success) {
        partiesFixed++;
        totalTransactions += res.transactionCount;
      }
    }

    const summary = await recalculateDashboardSummary(ledgerId);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('database-synced'));
    }

    return {
      success: true,
      partiesFixed,
      totalTransactions,
      totalReceivable: summary?.totalReceivable || 0,
      totalPayable: summary?.totalPayable || 0
    };
  } catch (err: any) {
    console.error('Failed to recalculate all ledger balances:', err);
    return {
      success: false,
      partiesFixed: 0,
      totalTransactions: 0,
      totalReceivable: 0,
      totalPayable: 0,
      error: err.message || String(err)
    };
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

