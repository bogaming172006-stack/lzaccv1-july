import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { User } from './types';
import { db, handleFirestoreError, OperationType, collection, onSnapshot, doc, getDoc, updateDoc } from './firebase';
import { logUserActivity } from './lib/activityLogger';
import { normalizeUser } from './lib/userRoleHelper';
import { getDeviceId, isDeviceAuthorized, getDeviceAuthWhatsAppUrl } from './lib/deviceId';

export interface LoginResult {
  success: boolean;
  isUnauthorizedDevice?: boolean;
  deviceId?: string;
  whatsappUrl?: string;
  user?: User;
  error?: string;
}

interface AuthContextType {
  currentUser: User | null;
  users: User[];
  login: (userId: string, pin: string) => LoginResult;
  logout: () => void;
  isLoading: boolean;
  error: string | null;
  currentDeviceId: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('ledger_current_user');
      return saved ? normalizeUser(JSON.parse(saved)) : null;
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

  // Track users in real time
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
      const dbUsers: User[] = [];
      snapshot.forEach(docSnap => {
        const u = docSnap.data() as User;
        if (u && u.id) {
          dbUsers.push(normalizeUser(u));
        }
      });
      
      setUsers(dbUsers);
      setErrorValue(null);

      // Verify currently logged in user still exists in database and this device is authorized
      if (currentUserRef.current) {
        const user = dbUsers.find(u => u.id === currentUserRef.current!.id);
        if (user) {
          const currentDev = getDeviceId();
          // If device authorization does not match, log out automatically!
          if (!isDeviceAuthorized(user, currentDev)) {
            console.warn('Device not authorized for active user. Signing out automatically.');
            setCurrentUser(null);
          } else {
            setCurrentUser(user);
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

  // Every 1 minute: check if the device ID matches the user's authorized device in database.
  // If match: continue session with no problem.
  // If not match: logout automatically!
  useEffect(() => {
    if (!currentUser) return;

    const intervalId = setInterval(async () => {
      try {
        const curDev = getDeviceId();
        const userDocRef = doc(db, 'users', currentUser.id);
        const docSnap = await getDoc(userDocRef);

        if (docSnap && docSnap.exists()) {
          const freshUser = normalizeUser(docSnap.data() as User);
          const isMatch = isDeviceAuthorized(freshUser, curDev);

          if (!isMatch) {
            console.warn(`[Security Check - 1 Min] Device ${curDev} does not match authorized device for ${currentUser.name}. Auto-logging out.`);
            logUserActivity('Auto Logout (Device Mismatch)', `Automatic logout: device ${curDev} is not authorized in database`, currentUser);
            setCurrentUser(null);
          } else {
            // Matches! Continue session with no problem
          }
        } else {
          // User deleted from database
          setCurrentUser(null);
        }
      } catch (err) {
        console.error('Error during 1-minute device check:', err);
      }
    }, 60 * 1000); // 1 minute (60 seconds)

    return () => clearInterval(intervalId);
  }, [currentUser]);

  const login = (usernameOrId: string, pin: string): LoginResult => {
    const searchStr = usernameOrId.trim().toLowerCase();
    const pinStr = pin.trim();
    const user = users.find(u => 
      (((u?.username || '').trim().toLowerCase() === searchStr) ||
       ((u?.name || '').trim().toLowerCase() === searchStr) ||
       ((u?.id || '').trim() === usernameOrId.trim())) &&
      String(u?.pin || '').trim() === pinStr
    );

    if (!user) {
      return { success: false, error: 'Invalid username or password' };
    }

    const deviceId = getDeviceId();
    const authorized = isDeviceAuthorized(user, deviceId);

    if (!authorized) {
      const whatsappUrl = getDeviceAuthWhatsAppUrl(user.name || user.username || usernameOrId, deviceId, user);
      
      // Update pending device request in Firestore so Admin sees it live
      updateDoc(doc(db, 'users', user.id), {
        pendingDeviceId: deviceId,
        pendingDeviceTime: Date.now(),
        lastAttemptedDevice: deviceId,
        lastActivity: Date.now()
      }).catch(e => console.error('Failed to log pending device request:', e));

      logUserActivity('Unauthorized Device Login Attempt', `Device ${deviceId} attempted login for user ${user.name}`, user);

      return {
        success: false,
        isUnauthorizedDevice: true,
        deviceId,
        whatsappUrl,
        user,
        error: `Device is not authorized. Please send Device ID ${deviceId} to Admin on WhatsApp (7501273632) for authorization.`
      };
    }

    // If user has no authorized device explicitly saved yet (e.g. first admin session), bind this device
    const updatePayload: Partial<User> & Record<string, any> = {
      lastActivity: Date.now(),
      lastAction: 'Logged into system',
      lastActionDetails: 'Session authenticated',
      lastDevice: deviceId,
      deviceId: deviceId,
      // Clear pending since this device is now authorized
      pendingDeviceId: ''
    };

    if (!user.authorizedDeviceId && (!user.authorizedDeviceIds || user.authorizedDeviceIds.length === 0)) {
      updatePayload.authorizedDeviceId = deviceId;
      updatePayload.authorizedDeviceIds = [deviceId];
      user.authorizedDeviceId = deviceId;
      user.authorizedDeviceIds = [deviceId];
    }

    setCurrentUser(user);
    updateDoc(doc(db, 'users', user.id), updatePayload)
      .catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${user.id}`));
    
    logUserActivity('User Login', `Authenticated session on device ${deviceId}`, user);
    return { success: true, deviceId, user };
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
    <AuthContext.Provider value={{ 
      currentUser, 
      users, 
      login, 
      logout, 
      isLoading, 
      error: errorValue,
      currentDeviceId: getDeviceId()
    }}>
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
