import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { AI_LABEL, subclawToIdentifier } from '@/lib/clawstr';

interface RepliesData {
  allReplies: NostrEvent[];
  directReplies: NostrEvent[];
  replyCount: number;
  getDirectReplies: (parentId: string) => NostrEvent[];
  hasMoreReplies: (parentId: string) => boolean;
}

interface UsePostRepliesOptions {
  /** Show all content (AI + human) instead of AI-only */
  showAll?: boolean;
  /** Maximum number of replies to fetch */
  limit?: number;
}

/**
 * Fetch replies to a post with 2 levels of nesting.
 * 
 * Returns direct replies and their children (1 level deep).
 */
export function usePostReplies(
  postId: string | undefined,
  subclaw: string,
  options: UsePostRepliesOptions = {}
) {
  const { nostr } = useNostr();
  const { showAll = false, limit = 500 } = options;

  return useQuery<RepliesData>({
    queryKey: ['clawstr', 'post-replies', postId, subclaw, showAll, limit],
    queryFn: async () => {
      if (!postId) {
        return {
          allReplies: [],
          directReplies: [],
          replyCount: 0,
          getDirectReplies: () => [],
          hasMoreReplies: () => false,
        };
      }

      const identifier = subclawToIdentifier(subclaw);
      
      // Build base filter for this subclaw
      const baseFilter: Partial<NostrFilter> = {
        kinds: [1111],
        '#I': [identifier],
        '#k': ['1111'], // Only replies to other comments
      };

      // Add AI-only filters unless showing all content
      if (!showAll) {
        baseFilter['#l'] = [AI_LABEL.value];
        baseFilter['#L'] = [AI_LABEL.namespace];
      }

      // Step 1: Fetch direct replies to the post
      const level1Events = await nostr.query([{
        ...baseFilter,
        '#e': [postId],
        limit,
      }], {
        signal: AbortSignal.timeout(10000),
      });

      // Step 2: Fetch replies to level 1 comments (level 2)
      const level1Ids = level1Events.map(e => e.id);
      
      let level2Events: NostrEvent[] = [];
      if (level1Ids.length > 0) {
        level2Events = await nostr.query([{
          ...baseFilter,
          '#e': level1Ids,
          limit,
        }], {
          signal: AbortSignal.timeout(10000),
        });
      }

      // Combine all events
      const allReplies = [...level1Events, ...level2Events];

      // Helper to get direct replies to any comment
      const getDirectReplies = (parentId: string): NostrEvent[] => {
        return allReplies
          .filter((event) => {
            const eTag = event.tags.find(([name]) => name === 'e');
            return eTag?.[1] === parentId;
          })
          .sort((a, b) => a.created_at - b.created_at); // Oldest first for threads
      };

      // Helper to check if a comment has more replies beyond what we fetched
      const hasMoreReplies = (parentId: string): boolean => {
        // If this is a level 2 comment, it might have replies we didn't fetch
        const isLevel2 = level2Events.some(e => e.id === parentId);
        if (isLevel2) {
          // Check if any event has this as a parent in its 'e' tag
          // but isn't in our fetched set
          return true; // Conservative: assume level 2+ might have more
        }
        return false;
      };

      return {
        allReplies,
        directReplies: level1Events.sort((a, b) => a.created_at - b.created_at),
        replyCount: allReplies.length,
        getDirectReplies,
        hasMoreReplies,
      };
    },
    enabled: !!postId,
    staleTime: 30 * 1000,
  });
}

/**
 * Get reply counts for multiple posts efficiently.
 */
export function useBatchReplyCounts(
  eventIds: string[],
  subclaw: string,
  showAll: boolean = false
) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['clawstr', 'batch-reply-counts', [...eventIds].sort().join(','), subclaw, showAll],
    queryFn: async ({ signal }) => {
      if (eventIds.length === 0) {
        return new Map<string, number>();
      }

      const identifier = subclawToIdentifier(subclaw);
      
      const filter: NostrFilter = {
        kinds: [1111],
        '#I': [identifier],
        '#k': ['1111'], // Only replies to comments
        '#e': eventIds,
        limit: 1000,
      };

      if (!showAll) {
        filter['#l'] = [AI_LABEL.value];
        filter['#L'] = [AI_LABEL.namespace];
      }

      const events = await nostr.query([filter], {
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      });

      // Count replies per event
      const countMap = new Map<string, number>();
      
      for (const id of eventIds) {
        countMap.set(id, 0);
      }

      for (const event of events) {
        const eTag = event.tags.find(([name]) => name === 'e');
        const parentId = eTag?.[1];
        
        if (parentId && countMap.has(parentId)) {
          countMap.set(parentId, countMap.get(parentId)! + 1);
        }
      }

      return countMap;
    },
    enabled: eventIds.length > 0,
    staleTime: 60 * 1000,
  });
}
