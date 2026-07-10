import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { User } from './types';
import { db, handleFirestoreError, OperationType, collection, onSnapshot, setDoc, doc, updateDoc } from './firebase';
import { v4 as uuidv4 } from 'uuid';

interface AuthContextType {
  currentUser: User | null;
  users: User[];
  login: (userId: string, pin: string) => boolean;
  logout: () => void;
  isLoading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Global memory for device id during a session
const getDeviceId = () => {
  try {
    let id = localStorage.getItem('ledger_device_id');
    if (!id) {
      id = uuidv4();
      localStorage.setItem('ledger_device_id', id);
    }
    return id;
  } catch (e) {
    return 'fallback-device-id';
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('ledger_current_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorValue, setErrorValue] = useState<string | null>(null);

  const currentUserRef = useRef<User | null>(currentUser);
  useEffect(() => {
    currentUserRef.current = currentUser;
    try {
      if (currentUser) {
        localStorage.setItem('ledger_current_user', JSON.stringify(currentUser));
      } else {
        localStorage.removeItem('ledger_current_user');
      }
    } catch (e) {
      console.error('Error saving user session:', e);
    }
  }, [currentUser]);

  // Track users
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
      const dbUsers: User[] = [];
      snapshot.forEach(doc => {
        dbUsers.push(doc.data() as User);
      });
      
      // Auto create admin if none exists
      if (dbUsers.length === 0) {
        const initialAdmin: User = {
          id: 'admin-1',
          name: 'Admin',
          pin: '1234',
          deviceId: '',
          lastActivity: Date.now(),
          isAdmin: true
        };
        setDoc(doc(db, 'users', 'admin-1'), initialAdmin)
          .catch(e => {
            setErrorValue(e instanceof Error ? e.message : String(e));
            handleFirestoreError(e, OperationType.CREATE, 'users/admin-1');
          });
        dbUsers.push(initialAdmin);
      }
      
      setUsers(dbUsers);
      setErrorValue(null);

      // We no longer rely on localStorage. If currentUser is set in memory, verify it still exists
      if (currentUserRef.current) {
        const user = dbUsers.find(u => u.id === currentUserRef.current!.id);
        if (user) {
          const isAnotherDevice = user.deviceId && user.deviceId !== getDeviceId();
          if (isAnotherDevice) {
            setCurrentUser(null);
          } else {
            // Check if properties actually changed to avoid unnecessary re-renders
            if (user.name !== currentUserRef.current.name || 
                user.pin !== currentUserRef.current.pin || 
                user.deviceId !== currentUserRef.current.deviceId ||
                user.lastActivity !== currentUserRef.current.lastActivity) {
              setCurrentUser(user);
            }
          }
        } else {
          setCurrentUser(null);
        }
      }
      setIsLoading(false);

    }, (error) => {
      setErrorValue(error instanceof Error ? error.message : String(error));
      setIsLoading(false);
      handleFirestoreError(error, OperationType.GET, 'users');
    });
    
    return () => unsub();
  }, []);

  const login = (userId: string, pin: string) => {
    const user = users.find(u => u.id === userId && u.pin === pin);
    if (user) {
      const deviceId = getDeviceId();
      setCurrentUser(user);
      updateDoc(doc(db, 'users', userId), {
        lastActivity: Date.now(),
        deviceId: deviceId
      }).catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${userId}`));
      return true;
    }
    return false;
  };

  const logout = () => {
    if (currentUser) {
      updateDoc(doc(db, 'users', currentUser.id), {
        deviceId: ''
      }).catch(console.error);
    }
    setCurrentUser(null);
  };

  return (
    <AuthContext.Provider value={{ currentUser, users, login, logout, isLoading, error: errorValue }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
