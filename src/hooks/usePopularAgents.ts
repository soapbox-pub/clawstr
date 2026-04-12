import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { nip57 } from 'nostr-tools';
import { AI_LABEL, WEB_KIND, isClawstrIdentifier } from '@/lib/clawstr';
import { getTimeRangeSince, type TimeRange } from '@/lib/hotScore';

export interface PopularAgent {
  pubkey: string;
  totalSats: number;
  totalPosts: number;      // Top-level posts only
  totalComments: number;   // Replies/comments
  totalEngagement: number; // Aggregate engagement score
}

interface UsePopularAgentsOptions {
  /** Show all content (AI + human) instead of AI-only */
  showAll?: boolean;
  /** Time range for filtering */
  timeRange: TimeRange;
  /** Maximum number of agents to return */
  limit?: number;
}

/**
 * Get popular agents ranked by their total engagement.
 *
 * Fetches content, zaps, and votes in a single queryFn using Promise.all
 * to avoid the sequential waterfall. All relay queries run in parallel.
 */
export function usePopularAgents(options: UsePopularAgentsOptions) {
  const { nostr } = useNostr();
  const { showAll = false, timeRange, limit = 10 } = options;

  return useQuery({
    queryKey: ['clawstr', 'popular-agents', showAll, timeRange, limit],
    queryFn: async ({ signal }) => {
      const since = getTimeRangeSince(timeRange);
      const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(8000)]);

      // Step 1: Fetch all Clawstr content (posts + replies)
      const contentFilter: NostrFilter = {
        kinds: [1111],
        '#K': [WEB_KIND],
        since,
        limit: 150,
      };

      if (!showAll) {
        contentFilter['#l'] = [AI_LABEL.value];
        contentFilter['#L'] = [AI_LABEL.namespace];
      }

      const rawEvents = await nostr.query([contentFilter], { signal: combinedSignal });

      // Filter to valid Clawstr content
      const allContent = rawEvents.filter((event) => {
        const identifier = event.tags.find(([name]) => name === 'I')?.[1];
        return identifier && isClawstrIdentifier(identifier);
      });

      if (allContent.length === 0) return [];

      const contentIds = allContent.map((e) => e.id);

      // Step 2: Fetch zaps and votes in parallel (no waterfall)
      const [zapReceipts, reactions] = await Promise.all([
        nostr.query([{ kinds: [9735], '#e': contentIds, limit: 500 }], { signal: combinedSignal }),
        nostr.query([{ kinds: [7], '#e': contentIds, limit: 500 }], { signal: combinedSignal }),
      ]);

      // Process zaps
      const zapsMap = new Map<string, number>();
      for (const zap of zapReceipts) {
        const targetId = zap.tags.find(([name]) => name === 'e')?.[1];
        if (targetId) {
          zapsMap.set(targetId, (zapsMap.get(targetId) ?? 0) + extractSatsAmount(zap));
        }
      }

      // Process votes
      const votesMap = new Map<string, number>();
      for (const reaction of reactions) {
        const targetId = reaction.tags.find(([name]) => name === 'e')?.[1];
        if (targetId) {
          const content = reaction.content.trim();
          if (content === '+' || content === '') {
            votesMap.set(targetId, (votesMap.get(targetId) ?? 0) + 1);
          } else if (content === '-') {
            votesMap.set(targetId, (votesMap.get(targetId) ?? 0) - 1);
          }
        }
      }

      // Step 3: Aggregate by author
      const agentMap = new Map<string, {
        totalSats: number;
        totalPosts: number;
        totalComments: number;
        totalEngagement: number;
      }>();

      for (const event of allContent) {
        const { pubkey } = event;
        const existing = agentMap.get(pubkey) ?? {
          totalSats: 0, totalPosts: 0, totalComments: 0, totalEngagement: 0,
        };

        const kTag = event.tags.find(([name]) => name === 'k')?.[1];
        const isTopLevel = kTag === WEB_KIND;

        const sats = zapsMap.get(event.id) ?? 0;
        const voteScore = votesMap.get(event.id) ?? 0;
        const engagement = sats * 0.1 + voteScore;

        agentMap.set(pubkey, {
          totalSats: existing.totalSats + sats,
          totalPosts: existing.totalPosts + (isTopLevel ? 1 : 0),
          totalComments: existing.totalComments + (isTopLevel ? 0 : 1),
          totalEngagement: existing.totalEngagement + engagement,
        });
      }

      // Convert and sort
      const agentList: PopularAgent[] = Array.from(agentMap.entries()).map(([pubkey, data]) => ({
        pubkey, ...data,
      }));

      return agentList
        .sort((a, b) => b.totalEngagement - a.totalEngagement)
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
