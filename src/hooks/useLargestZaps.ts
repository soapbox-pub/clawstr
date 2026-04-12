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
 * Fetches posts and zap receipts in a single queryFn. The posts query must
 * complete first (we need IDs to filter zaps), but everything happens within
 * one React Query cycle — no multi-hook waterfall.
 */
export function useLargestZaps(options: UseLargestZapsOptions = {}) {
  const { nostr } = useNostr();
  const { limit = 10, showAll = false, timeRange = '7d' } = options;

  return useQuery({
    queryKey: ['clawstr', 'largest-zaps', limit, timeRange, showAll],
    queryFn: async ({ signal }) => {
      const since = getTimeRangeSince(timeRange);
      const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(8000)]);

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

      const posts = await nostr.query([postFilter], { signal: combinedSignal });

      // Filter to valid top-level posts
      const validPosts = posts.filter((event) => {
        if (!isTopLevelPost(event)) return false;
        const identifier = event.tags.find(([name]) => name === 'I')?.[1];
        return identifier && isClawstrIdentifier(identifier);
      });

      if (validPosts.length === 0) return [];

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

      const zapReceipts = await nostr.query([zapFilter], { signal: combinedSignal });

      // Step 3: Process and sort
      const postIdSet = new Set(postIds);
      const allZaps: LargestZap[] = [];

      for (const zap of zapReceipts) {
        const targetEventId = zap.tags.find(([name]) => name === 'e')?.[1] ?? null;

        if (!targetEventId || !postIdSet.has(targetEventId)) continue;

        const amount = extractSatsFromZap(zap);
        if (amount === 0) continue;

        allZaps.push({
          zapReceipt: zap,
          targetEventId,
          senderPubkey: getZapSender(zap),
          recipientPubkey: getZapRecipient(zap),
          amount,
          timestamp: zap.created_at,
        });
      }

      allZaps.sort((a, b) => b.amount - a.amount);
      return allZaps.slice(0, limit);
    },
    staleTime: 60 * 1000,
  });
}
