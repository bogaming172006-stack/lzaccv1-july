import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Ledger } from './types';
import { db, handleFirestoreError, OperationType, collection, onSnapshot, setDoc, doc } from './firebase';
import { v4 as uuidv4 } from 'uuid';

interface LedgerContextType {
  ledgers: Ledger[];
  activeLedger: Ledger | null;
  setActiveLedgerId: (id: string) => void;
  createLedger: (name: string, type: Ledger['type']) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

const LedgerContext = createContext<LedgerContextType | undefined>(undefined);

export const LedgerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [activeLedgerId, setActiveLedgerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorValue, setErrorValue] = useState<string | null>(null);

  const activeLedgerIdRef = useRef<string | null>(activeLedgerId);
  const autoCreatingRef = useRef<boolean>(false);

  useEffect(() => {
    activeLedgerIdRef.current = activeLedgerId;
  }, [activeLedgerId]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'ledgers'), (snapshot) => {
      const dbLedgers: Ledger[] = [];
      snapshot.forEach(d => {
        dbLedgers.push(d.data() as Ledger);
      });
      
      setLedgers(dbLedgers);
      setErrorValue(null);

      // Set active ledger safely
      const currentActiveId = activeLedgerIdRef.current;
      if (dbLedgers.length === 0) {
        setActiveLedgerId(null);
      } else if (!currentActiveId) {
        setActiveLedgerId(dbLedgers[0].id);
      } else if (currentActiveId && !dbLedgers.find(l => l.id === currentActiveId)) {
        setActiveLedgerId(dbLedgers[0].id);
      }
      setIsLoading(false);
    }, (error) => {
      setErrorValue(error instanceof Error ? error.message : String(error));
      setIsLoading(false);
      handleFirestoreError(error, OperationType.GET, 'ledgers');
    });
    
    return () => unsub();
  }, []);

  const createLedger = async (name: string, type: Ledger['type']) => {
    const newLedger: Ledger = {
      id: uuidv4(),
      name,
      type,
      createdAt: Date.now()
    };
    try {
      await setDoc(doc(db, 'ledgers', newLedger.id), newLedger);
      setActiveLedgerId(newLedger.id);
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, `ledgers/${newLedger.id}`);
    }
  };

  const activeLedger = ledgers.find(l => l.id === activeLedgerId) || null;

  return (
    <LedgerContext.Provider value={{ ledgers, activeLedger, setActiveLedgerId, createLedger, isLoading, error: errorValue }}>
      {children}
    </LedgerContext.Provider>
  );
};

export const useLedger = () => {
  const context = useContext(LedgerContext);
  if (context === undefined) {
    throw new Error('useLedger must be used within a LedgerProvider');
  }
  return context;
};
