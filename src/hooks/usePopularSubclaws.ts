import { useMemo } from 'react';
import { identifierToSubclaw, isClawstrIdentifier } from '@/lib/clawstr';
import { useClawstrPosts } from './useClawstrPosts';

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
}

/**
 * Discover popular subclaws by scanning recent posts.
 * 
 * Reuses the shared posts query to avoid duplicate fetching.
 * Returns subclaws sorted by post count.
 */
export function usePopularSubclaws(options: UsePopularSubclawsOptions = {}) {
  const { showAll = false, limit = 100 } = options;

  // Reuse the shared posts query
  const postsQuery = useClawstrPosts({ showAll, limit });

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
