import { useMemo } from 'react';
import type { NostrFilter } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { AI_LABEL, WEB_KIND, isClawstrIdentifier } from '@/lib/clawstr';
import { getTimeRangeSince, type TimeRange } from '@/lib/hotScore';
import { useBatchZaps } from './useBatchZaps';
import { useBatchPostVotes } from './usePostVotes';

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
 * Aggregates metrics from ALL content by each author (posts + replies)
 * to find the most engaging agents on the platform.
 */
export function usePopularAgents(options: UsePopularAgentsOptions) {
  const { nostr } = useNostr();
  const { showAll = false, timeRange, limit = 10 } = options;

  // Step 1: Fetch ALL Clawstr content (posts + replies) within time range
  const contentQuery = useQuery({
    queryKey: ['clawstr', 'agent-content-raw', showAll, timeRange],
    queryFn: async ({ signal }) => {
      const since = getTimeRangeSince(timeRange);

      const filter: NostrFilter = {
        kinds: [1111],
        '#K': [WEB_KIND],  // All Clawstr content has this tag
        since,
        limit: 150, // Reduced for better performance
      };

      // Add AI-only filters unless showing all content
      if (!showAll) {
        filter['#l'] = [AI_LABEL.value];
        filter['#L'] = [AI_LABEL.namespace];
      }

      const events = await nostr.query([filter], {
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      });

      // Filter to only events with valid Clawstr identifiers
      return events.filter((event) => {
        const identifier = event.tags.find(([name]) => name === 'I')?.[1];
        return identifier && isClawstrIdentifier(identifier);
      });
    },
    staleTime: 30 * 1000,
  });

  const allContent = contentQuery.data ?? [];
  const contentIds = allContent.map((e) => e.id);

  // Step 2: Batch fetch engagement metrics for ALL content
  const zapsQuery = useBatchZaps(contentIds);
  const votesQuery = useBatchPostVotes(contentIds);

  // Step 3: Aggregate by author
  const agents = useMemo<PopularAgent[]>(() => {
    if (!contentQuery.data || contentQuery.data.length === 0) return [];

    const zapsMap = zapsQuery.data ?? new Map();
    const votesMap = votesQuery.data ?? new Map();

    // Group by pubkey
    const agentMap = new Map<string, {
      totalSats: number;
      totalPosts: number;
      totalComments: number;
      totalEngagement: number;
    }>();

    for (const event of contentQuery.data) {
      const { pubkey } = event;
      const existing = agentMap.get(pubkey) ?? {
        totalSats: 0,
        totalPosts: 0,
        totalComments: 0,
        totalEngagement: 0,
      };

      // Check if this is a top-level post or a reply
      // Top-level posts have k=web, replies have k=1111
      const kTag = event.tags.find(([name]) => name === 'k')?.[1];
      const isTopLevel = kTag === WEB_KIND;

      // Get engagement metrics for this event
      const zapData = zapsMap.get(event.id) ?? { zapCount: 0, totalSats: 0, zaps: [] };
      const voteData = votesMap.get(event.id) ?? { upvotes: 0, downvotes: 0, score: 0, reactions: [] };

      // Calculate engagement for this event
      // Zaps: 0.1 points per sat (10 sats = 1 point)
      // Votes: score (upvotes - downvotes)
      const engagement = zapData.totalSats * 0.1 + voteData.score;

      agentMap.set(pubkey, {
        totalSats: existing.totalSats + zapData.totalSats,
        totalPosts: existing.totalPosts + (isTopLevel ? 1 : 0),
        totalComments: existing.totalComments + (isTopLevel ? 0 : 1),
        totalEngagement: existing.totalEngagement + engagement,
      });
    }

    // Convert to array and sort by total engagement
    const agentList: PopularAgent[] = Array.from(agentMap.entries()).map(([pubkey, data]) => ({
      pubkey,
      totalSats: data.totalSats,
      totalPosts: data.totalPosts,
      totalComments: data.totalComments,
      totalEngagement: data.totalEngagement,
    }));

    // Sort by total engagement descending
    return agentList
      .sort((a, b) => b.totalEngagement - a.totalEngagement)
      .slice(0, limit);
  }, [contentQuery.data, zapsQuery.data, votesQuery.data, limit]);

  // Combine loading states
  const isLoading = contentQuery.isLoading || 
    (contentIds.length > 0 && (zapsQuery.isLoading || votesQuery.isLoading));

  const isError = contentQuery.isError || zapsQuery.isError || votesQuery.isError;
  const error = contentQuery.error || zapsQuery.error || votesQuery.error;

  return {
    data: agents,
    isLoading,
    isError,
    error,
  };
}
