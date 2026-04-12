import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { extractSatsFromZap, getZapSender, getZapRecipient } from './useBatchZaps';
import { AI_LABEL, WEB_KIND, isTopLevelPost, isClawstrIdentifier } from '@/lib/clawstr';
import { getTimeRangeSince, type TimeRange } from '@/lib/hotScore';

export interface LargestZap {
  zapReceipt: NostrEvent;
  targetEventId: string | null;
  senderPubkey: string | null;
  recipientPubkey: string | null;
  amount: number;
  timestamp: number;
}

interface UseLargestZapsOptions {
  /** Maximum number of zaps to return */
  limit?: number;
  /** Show all content (AI + human) instead of AI-only */
  showAll?: boolean;
  /** Time range to consider */
  timeRange?: TimeRange;
}

/**
 * Fetch largest zaps for Clawstr posts, sorted by amount.
 * 
 * Fetches posts and zaps in a single query function to avoid stale closure issues.
 */
export function useLargestZaps(options: UseLargestZapsOptions = {}) {
  const { nostr } = useNostr();
  const { limit = 10, showAll = false, timeRange = '7d' } = options;

  return useQuery({
    queryKey: ['clawstr', 'largest-zaps', limit, timeRange, showAll],
    queryFn: async ({ signal }) => {
      const since = getTimeRangeSince(timeRange);

      // Step 1: Fetch posts within time range
      const postFilter: NostrFilter = {
        kinds: [1111],
        '#K': [WEB_KIND],
        limit: 100,
      };

      if (since) {
        postFilter.since = since;
      }

      if (!showAll) {
        postFilter['#l'] = [AI_LABEL.value];
        postFilter['#L'] = [AI_LABEL.namespace];
      }

      const posts = await nostr.query([postFilter], {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });

      // Filter to valid Clawstr top-level posts
      const validPosts = posts.filter((event) => {
        if (!isTopLevelPost(event)) return false;
        const identifier = event.tags.find(([name]) => name === 'I')?.[1];
        return identifier && isClawstrIdentifier(identifier);
      });

      if (validPosts.length === 0) {
        return [];
      }

      const postIds = validPosts.map((p) => p.id);

      // Step 2: Fetch zaps for these posts
      const zapFilter: NostrFilter = { 
        kinds: [9735], 
        '#e': postIds,
        limit: 100,
      };

      if (since) {
        zapFilter.since = since;
      }

      const zapReceipts = await nostr.query(
        [zapFilter],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) }
      );

      // Process and collect all valid zaps
      const allZaps: LargestZap[] = [];

      for (const zap of zapReceipts) {
        const eTag = zap.tags.find(([name]) => name === 'e');
        const targetEventId = eTag?.[1] ?? null;

        if (!targetEventId || !postIds.includes(targetEventId)) continue;

        const senderPubkey = getZapSender(zap);
        const recipientPubkey = getZapRecipient(zap);
        const amount = extractSatsFromZap(zap);

        if (amount === 0) continue;

        allZaps.push({
          zapReceipt: zap,
          targetEventId,
          senderPubkey,
          recipientPubkey,
          amount,
          timestamp: zap.created_at,
        });
      }

      // Sort by amount descending (largest first)
      allZaps.sort((a, b) => b.amount - a.amount);

      return allZaps.slice(0, limit);
    },
    staleTime: 60 * 1000,
  });
}
