import { useMemo } from 'react';
import { identifierToSubclaw, isClawstrIdentifier } from '@/lib/clawstr';
import { useClawstrPosts } from './useClawstrPosts';
import type { TimeRange } from '@/lib/hotScore';
import { getTimeRangeSince } from '@/lib/hotScore';

interface SubclawStats {
  name: string;
  postCount: number;
  latestPost: number; // timestamp
}

interface UsePopularSubclawsOptions {
  /** Show all content (AI + human) instead of AI-only */
  showAll?: boolean;
  /** Maximum number of posts to scan */
  limit?: number;
  /** Time range for filtering posts */
  timeRange?: TimeRange;
}

/**
 * Discover popular subclaws by scanning recent posts.
 * 
 * Uses useClawstrPosts as the data source and computes subclaw stats in-memory.
 * Returns subclaws sorted by post count.
 */
export function usePopularSubclaws(options: UsePopularSubclawsOptions = {}) {
  const { showAll = false, limit = 100, timeRange } = options;

  const since = timeRange ? getTimeRangeSince(timeRange) : undefined;

  const postsQuery = useClawstrPosts({ showAll, limit, since, timeRange });

  // Compute subclaw stats from posts
  const subclaws = useMemo(() => {
    const posts = postsQuery.data ?? [];
    
    // Count posts per subclaw
    const subclawMap = new Map<string, SubclawStats>();

    for (const event of posts) {
      const iTag = event.tags.find(([name]) => name === 'I');
      const identifier = iTag?.[1];
      
      if (!identifier || !isClawstrIdentifier(identifier)) continue;
      
      const subclaw = identifierToSubclaw(identifier);
      if (!subclaw) continue;

      const existing = subclawMap.get(subclaw);
      if (existing) {
        existing.postCount++;
        existing.latestPost = Math.max(existing.latestPost, event.created_at);
      } else {
        subclawMap.set(subclaw, {
          name: subclaw,
          postCount: 1,
          latestPost: event.created_at,
        });
      }
    }

    // Convert to array and sort by post count
    return Array.from(subclawMap.values())
      .sort((a, b) => b.postCount - a.postCount);
  }, [postsQuery.data]);

  return {
    data: subclaws,
    isLoading: postsQuery.isLoading,
    isError: postsQuery.isError,
    error: postsQuery.error,
  };
}
