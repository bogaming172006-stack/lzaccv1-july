import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { User } from './types';
import { db, handleFirestoreError, OperationType, collection, onSnapshot, setDoc, doc, updateDoc } from './firebase';
import { v4 as uuidv4 } from 'uuid';
import { logUserActivity } from './lib/activityLogger';

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
        const u = doc.data() as User;
        if (u && u.id) {
          dbUsers.push(u);
        }
      });
      
      setUsers(dbUsers);
      setErrorValue(null);

      // Verify currently logged in user still exists in database
      if (currentUserRef.current) {
        const user = dbUsers.find(u => u.id === currentUserRef.current!.id);
        if (user) {
          const isAnotherDevice = user.deviceId && user.deviceId !== getDeviceId();
          if (isAnotherDevice) {
            setCurrentUser(null);
          } else {
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

  const login = (usernameOrId: string, pin: string) => {
    const searchStr = usernameOrId.trim();
    const user = users.find(u => 
      (((u?.name || '').trim() === searchStr) ||
       ((u?.id || '').trim() === searchStr)) &&
      String(u?.pin || '').trim() === pin.trim()
    );
    if (user) {
      const deviceId = getDeviceId();
      setCurrentUser(user);
      updateDoc(doc(db, 'users', user.id), {
        lastActivity: Date.now(),
        lastAction: 'Logged into system',
        lastActionDetails: 'Session authenticated with PIN',
        lastDevice: deviceId,
        deviceId: deviceId
      }).catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${user.id}`));
      
      logUserActivity('User Login', 'Authenticated via 4-digit PIN', user);
      return true;
    }
    return false;
  };

  const logout = () => {
    if (currentUser) {
      logUserActivity('User Logout', 'Signed out of session', currentUser);
      updateDoc(doc(db, 'users', currentUser.id), {
        deviceId: '',
        lastAction: 'Logged out'
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
