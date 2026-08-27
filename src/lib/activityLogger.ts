import { db, doc, updateDoc, setDoc, collection, getDocs, query, where, limit } from '../firebase';
import { User, UserActivity } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Log a user action to Firestore both in the user document (for quick summary)
 * and in the user_activities collection (for full historical timeline).
 */
export async function logUserActivity(
  action: string,
  details?: string,
  userOverride?: User | null,
  ledgerName?: string,
  ledgerId?: string
) {
  try {
    let currentUser: User | null = userOverride || null;
    if (!currentUser) {
      const saved = localStorage.getItem('ledger_current_user');
      if (saved) {
        currentUser = JSON.parse(saved);
      }
    }

    if (!currentUser || !currentUser.id) return;

    const now = Date.now();
    const deviceId = localStorage.getItem('ledger_device_id') || 'browser';

    // 1. Update user record summary
    updateDoc(doc(db, 'users', currentUser.id), {
      lastActivity: now,
      lastAction: action,
      lastActionDetails: details || '',
      lastDevice: deviceId,
    }).catch(() => {
      // Ignore background error
    });

    // 2. Insert into user_activities log
    const activityId = uuidv4();
    const activityItem: UserActivity = {
      id: activityId,
      userId: currentUser.id,
      userName: currentUser.name || 'Unknown',
      action,
      details: details || '',
      ledgerId: ledgerId || '',
      ledgerName: ledgerName || '',
      timestamp: now,
      deviceId,
    };

    setDoc(doc(db, 'user_activities', activityId), activityItem).catch(() => {
      // Ignore background error
    });
  } catch (err) {
    console.error('Failed to log user activity:', err);
  }
}

/**
 * Fetch recent activity records for a specific user or all users
 */
export async function fetchUserActivities(userId?: string, maxItems: number = 50): Promise<UserActivity[]> {
  try {
    const activitiesRef = collection(db, 'user_activities');
    const snap = await getDocs(activitiesRef);
    let list: UserActivity[] = [];

    snap.forEach((d) => {
      if (d.exists()) {
        const item = d.data() as UserActivity;
        if (!userId || item.userId === userId) {
          list.push(item);
        }
      }
    });

    // Sort newest first
    list.sort((a, b) => b.timestamp - a.timestamp);
    return list.slice(0, maxItems);
  } catch (err) {
    console.error('Error fetching user activities:', err);
    return [];
  }
}
