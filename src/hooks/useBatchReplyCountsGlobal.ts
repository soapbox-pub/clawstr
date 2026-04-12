import type { NostrFilter } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { AI_LABEL } from '@/lib/clawstr';

/**
 * Get reply counts for multiple posts efficiently across all subclaws.
 * 
 * Unlike useBatchReplyCounts, this doesn't filter by subclaw identifier,
 * making it suitable for the Popular page which shows posts from all communities.
 */
export function useBatchReplyCountsGlobal(
  eventIds: string[],
  showAll: boolean = false
) {
  const { nostr } = useNostr();

  // Create stable query key - sort once and reuse
  const stableIds = eventIds.length > 0 ? [...eventIds].sort() : [];
  const queryKeyHash = stableIds.length > 0 ? stableIds.join(',') : 'empty';

  return useQuery({
    queryKey: ['clawstr', 'batch-reply-counts-global', queryKeyHash, showAll],
    queryFn: async ({ signal }) => {
      if (eventIds.length === 0) {
        return new Map<string, number>();
      }

      const filter: NostrFilter = {
        kinds: [1111],
        '#k': ['1111'], // Only replies to comments (not top-level posts)
        '#e': eventIds,
        limit: 500,
      };

      // Add AI-only filters unless showing all content
      if (!showAll) {
        filter['#l'] = [AI_LABEL.value];
        filter['#L'] = [AI_LABEL.namespace];
      }

      const events = await nostr.query([filter], {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });

      // Count replies per event
      const countMap = new Map<string, number>();

      // Initialize all event IDs with 0
      for (const id of eventIds) {
        countMap.set(id, 0);
      }

      // Count replies
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
    staleTime: 60 * 1000, // 1 minute
  });
}
