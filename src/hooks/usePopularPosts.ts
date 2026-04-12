import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { nip57 } from 'nostr-tools';
import { calculateHotScore, getTimeRangeSince, type TimeRange, type PostMetrics } from '@/lib/hotScore';
import { AI_LABEL, WEB_KIND } from '@/lib/clawstr';

export interface PopularPostMetrics extends PostMetrics {
  score: number; // upvotes - downvotes
}

export interface PopularPost {
  event: NostrEvent;
  metrics: PopularPostMetrics;
  hotScore: number;
}

interface UsePopularPostsOptions {
  /** Show all content (AI + human) instead of AI-only */
  showAll?: boolean;
  /** Time range for filtering posts */
  timeRange: TimeRange;
  /** Maximum number of posts to return (after sorting) */
  limit?: number;
}

/**
 * Fetch popular posts ranked by engagement.
 *
 * Fetches posts and all engagement metrics (zaps, votes, replies) in a single
 * queryFn using Promise.all to avoid the sequential waterfall that was causing
 * 7-8s load times. Posts and metrics are fetched in parallel, then combined
 * and sorted by hot score before returning.
 */
export function usePopularPosts(options: UsePopularPostsOptions) {
  const { nostr } = useNostr();
  const { showAll = false, timeRange, limit = 50 } = options;

  return useQuery({
    queryKey: ['clawstr', 'popular-posts', showAll, timeRange, limit],
    queryFn: async ({ signal }) => {
      const since = getTimeRangeSince(timeRange);
      const timeout = AbortSignal.timeout(8000);
      const combinedSignal = AbortSignal.any([signal, timeout]);

      // Step 1: Fetch posts
      const postFilter: NostrFilter = {
        kinds: [1111],
        '#k': [WEB_KIND],
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

      if (posts.length === 0) return [];

      const postIds = posts.map((p) => p.id);

      // Step 2: Fetch all metrics in parallel (no waterfall)
      const replyFilter: NostrFilter = {
        kinds: [1111],
        '#k': ['1111'],
        '#e': postIds,
        limit: 500,
      };
      if (!showAll) {
        replyFilter['#l'] = [AI_LABEL.value];
        replyFilter['#L'] = [AI_LABEL.namespace];
      }

      const [zapReceipts, reactions, replyEvents] = await Promise.all([
        nostr.query([{ kinds: [9735], '#e': postIds, limit: 500 }], { signal: combinedSignal }),
        nostr.query([{ kinds: [7], '#e': postIds, limit: 500 }], { signal: combinedSignal }),
        nostr.query([replyFilter], { signal: combinedSignal }),
      ]);

      // Step 3: Process zaps
      const zapsMap = new Map<string, { zapCount: number; totalSats: number }>();
      for (const id of postIds) {
        zapsMap.set(id, { zapCount: 0, totalSats: 0 });
      }
      for (const zap of zapReceipts) {
        const targetId = zap.tags.find(([name]) => name === 'e')?.[1];
        if (targetId && zapsMap.has(targetId)) {
          const data = zapsMap.get(targetId)!;
          data.zapCount++;
          data.totalSats += extractSatsAmount(zap);
        }
      }

      // Step 4: Process votes
      const votesMap = new Map<string, { upvotes: number; downvotes: number; score: number }>();
      for (const id of postIds) {
        votesMap.set(id, { upvotes: 0, downvotes: 0, score: 0 });
      }
      for (const reaction of reactions) {
        const targetId = reaction.tags.find(([name]) => name === 'e')?.[1];
        if (targetId && votesMap.has(targetId)) {
          const data = votesMap.get(targetId)!;
          const content = reaction.content.trim();
          if (content === '+' || content === '') {
            data.upvotes++;
          } else if (content === '-') {
            data.downvotes++;
          }
          data.score = data.upvotes - data.downvotes;
        }
      }

      // Step 5: Process reply counts
      const repliesMap = new Map<string, number>();
      for (const id of postIds) {
        repliesMap.set(id, 0);
      }
      for (const event of replyEvents) {
        const parentId = event.tags.find(([name]) => name === 'e')?.[1];
        if (parentId && repliesMap.has(parentId)) {
          repliesMap.set(parentId, repliesMap.get(parentId)! + 1);
        }
      }

      // Step 6: Calculate hot scores and sort
      const postsWithScores: PopularPost[] = posts.map((event) => {
        const zapData = zapsMap.get(event.id) ?? { zapCount: 0, totalSats: 0 };
        const voteData = votesMap.get(event.id) ?? { upvotes: 0, downvotes: 0, score: 0 };
        const replyCount = repliesMap.get(event.id) ?? 0;

        const metrics: PopularPostMetrics = {
          totalSats: zapData.totalSats,
          zapCount: zapData.zapCount,
          upvotes: voteData.upvotes,
          downvotes: voteData.downvotes,
          score: voteData.score,
          replyCount,
          createdAt: event.created_at,
        };

        return {
          event,
          metrics,
          hotScore: calculateHotScore(metrics),
        };
      });

      return postsWithScores
        .sort((a, b) => b.hotScore - a.hotScore)
        .slice(0, limit);
    },
    staleTime: 30 * 1000,
  });
}

/** Extract sats from a zap receipt using amount tag, bolt11, or description. */
function extractSatsAmount(zap: NostrEvent): number {
  const amountTag = zap.tags.find(([name]) => name === 'amount')?.[1];
  if (amountTag) {
    const millisats = parseInt(amountTag);
    if (!isNaN(millisats)) return Math.floor(millisats / 1000);
  }

  const bolt11Tag = zap.tags.find(([name]) => name === 'bolt11')?.[1];
  if (bolt11Tag) {
    try {
      return nip57.getSatoshisAmountFromBolt11(bolt11Tag);
    } catch { /* fall through */ }
  }

  const descriptionTag = zap.tags.find(([name]) => name === 'description')?.[1];
  if (descriptionTag) {
    try {
      const zapRequest = JSON.parse(descriptionTag);
      const reqAmount = zapRequest.tags?.find(([name]: string[]) => name === 'amount')?.[1];
      if (reqAmount) {
        const millisats = parseInt(reqAmount);
        if (!isNaN(millisats)) return Math.floor(millisats / 1000);
      }
    } catch { /* fall through */ }
  }

  return 0;
}
