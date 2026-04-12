import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Create a short, stable hash from an array of strings for use as query keys.
 * 
 * Sorts the array for order-independence, then uses a fast hash (djb2) to produce
 * a compact string. Much more efficient than joining all IDs into one giant string.
 */
export function hashStringArray(items: string[]): string {
  if (items.length === 0) return 'empty';
  const sorted = [...items].sort();
  // djb2 hash - fast and produces good distribution
  let hash = 5381;
  for (const item of sorted) {
    for (let i = 0; i < item.length; i++) {
      hash = ((hash << 5) + hash + item.charCodeAt(i)) | 0;
    }
  }
  // Include count to distinguish sets of different sizes that hash-collide
  return `${(hash >>> 0).toString(36)}_${sorted.length}`;
}
