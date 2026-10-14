import { db, doc, getDoc, setDoc } from '../firebase';
import { Party } from '../types';

const STORAGE_PREFIX = 'party_groups_';

export function getLocalPartyGroups(ledgerId: string): string[] {
  if (!ledgerId) return [];
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${ledgerId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((g): g is string => typeof g === 'string' && g.trim().length > 0);
      }
    }
  } catch (e) {
    console.error('Failed to read party groups from localStorage:', e);
  }
  return [];
}

export function setLocalPartyGroups(ledgerId: string, groups: string[]) {
  if (!ledgerId) return;
  try {
    const clean = Array.from(new Set(groups.map(g => g.trim()).filter(Boolean)));
    localStorage.setItem(`${STORAGE_PREFIX}${ledgerId}`, JSON.stringify(clean));
  } catch (e) {
    console.error('Failed to save party groups to localStorage:', e);
  }
}

export async function fetchPartyGroups(ledgerId: string): Promise<string[]> {
  if (!ledgerId) return [];
  const local = getLocalPartyGroups(ledgerId);
  try {
    const docRef = doc(db, 'party_groups', ledgerId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      const remoteGroups = Array.isArray(data?.groups) ? data.groups : [];
      const merged = Array.from(new Set([...local, ...remoteGroups].map(g => g.trim()).filter(Boolean)));
      setLocalPartyGroups(ledgerId, merged);
      return merged;
    }
  } catch (err) {
    console.warn('Could not fetch party groups from Firestore, using local fallback:', err);
  }
  return local;
}

export async function addPartyGroup(ledgerId: string, groupName: string): Promise<string[]> {
  const cleanName = groupName.trim();
  if (!ledgerId || !cleanName) return getLocalPartyGroups(ledgerId);

  const current = getLocalPartyGroups(ledgerId);
  if (!current.includes(cleanName)) {
    current.push(cleanName);
  }
  setLocalPartyGroups(ledgerId, current);

  try {
    const docRef = doc(db, 'party_groups', ledgerId);
    await setDoc(docRef, {
      ledgerId,
      groups: current,
      updatedAt: Date.now()
    }, { merge: true });
  } catch (err) {
    console.warn('Could not sync new party group to Firestore:', err);
  }

  return current;
}

export async function deletePartyGroup(ledgerId: string, groupNameToRemove: string): Promise<string[]> {
  if (!ledgerId || !groupNameToRemove) return getLocalPartyGroups(ledgerId);

  const current = getLocalPartyGroups(ledgerId).filter(g => g !== groupNameToRemove);
  setLocalPartyGroups(ledgerId, current);

  try {
    const docRef = doc(db, 'party_groups', ledgerId);
    await setDoc(docRef, {
      ledgerId,
      groups: current,
      updatedAt: Date.now()
    }, { merge: true });
  } catch (err) {
    console.warn('Could not sync deleted party group to Firestore:', err);
  }

  return current;
}

export function mergePartyGroups(parties: Party[], storedGroups: string[]): string[] {
  const set = new Set<string>();
  
  storedGroups.forEach(g => {
    const trimmed = (g || '').trim();
    if (trimmed) set.add(trimmed);
  });

  parties.forEach(p => {
    const trimmed = (p.group || '').trim();
    if (trimmed) set.add(trimmed);
  });

  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
