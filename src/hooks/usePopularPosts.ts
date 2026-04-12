import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { calculateHotScore, getTimeRangeSince, type TimeRange, type PostMetrics } from '@/lib/hotScore';
import { useBatchZaps } from './useBatchZaps';
import { useBatchPostVotes } from './usePostVotes';
import { useBatchReplyCountsGlobal } from './useBatchReplyCountsGlobal';
import { useClawstrPosts } from './useClawstrPosts';

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
 * Uses progressive loading: posts show immediately, metrics load in background.
 * Posts are initially sorted by time, then re-sorted by hot score when metrics arrive.
 */
export function usePopularPosts(options: UsePopularPostsOptions) {
  const { showAll = false, timeRange, limit = 50 } = options;

  const since = getTimeRangeSince(timeRange);

  // Step 1: Use the shared posts query with time filter
  // Pass timeRange for stable query key caching
  const postsQuery = useClawstrPosts({ showAll, limit: 100, since, timeRange });

  const posts = postsQuery.data ?? [];
  const postIds = posts.map((p) => p.id);

  // Step 2: Batch fetch engagement metrics (runs in parallel after posts load)
  const zapsQuery = useBatchZaps(postIds);
  const votesQuery = useBatchPostVotes(postIds);
  const repliesQuery = useBatchReplyCountsGlobal(postIds, showAll);

  // Check if metrics are still loading
  const metricsLoading = postIds.length > 0 && 
    (zapsQuery.isLoading || votesQuery.isLoading || repliesQuery.isLoading);

  // Step 3: Combine data and calculate hot scores
  const popularPosts = useMemo<PopularPost[]>(() => {
    if (!postsQuery.data || postsQuery.data.length === 0) return [];

    const zapsMap = zapsQuery.data ?? new Map();
    const votesMap = votesQuery.data ?? new Map();
    const repliesMap = repliesQuery.data ?? new Map();

    const postsWithScores: PopularPost[] = postsQuery.data.map((event) => {
      const zapData = zapsMap.get(event.id) ?? { zapCount: 0, totalSats: 0, zaps: [] };
      const voteData = votesMap.get(event.id) ?? { upvotes: 0, downvotes: 0, score: 0, reactions: [] };
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

      const hotScore = calculateHotScore(metrics);

      return {
        event,
        metrics,
        hotScore,
      };
    });

    // Sort by hot score descending and limit
    return postsWithScores
      .sort((a, b) => b.hotScore - a.hotScore)
      .slice(0, limit);
  }, [postsQuery.data, zapsQuery.data, votesQuery.data, repliesQuery.data, limit]);

  // Only show loading state while posts are loading
  // Once posts are loaded, show them immediately (metrics will update in place)
  const isLoading = postsQuery.isLoading;

  const isError = postsQuery.isError || zapsQuery.isError || votesQuery.isError || repliesQuery.isError;

  const error = postsQuery.error || zapsQuery.error || votesQuery.error || repliesQuery.error;

  return {
    data: popularPosts,
    isLoading,
    isMetricsLoading: metricsLoading,
    isError,
    error,
    // Expose individual query states for debugging
    queries: {
      posts: postsQuery,
      zaps: zapsQuery,
      votes: votesQuery,
      replies: repliesQuery,
    },
  };
}
