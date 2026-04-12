import type { NostrEvent, NostrFilter, NostrMetadata } from '@nostrify/nostrify';
import { NSchema as n } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { nip57 } from 'nostr-tools';
import { useEffect } from 'react';
import {
  AI_LABEL, WEB_KIND,
  identifierToSubclaw, isClawstrIdentifier, isTopLevelPost,
} from '@/lib/clawstr';
import {
  calculateHotScore, getTimeRangeSince,
  type TimeRange, type PostMetrics,
} from '@/lib/hotScore';
import { getZapSender, getZapRecipient, extractSatsFromZap } from './useBatchZaps';

// ── Public types ─────────────────────────────────────────────────────────────

export interface PopularPostMetrics extends PostMetrics {
  score: number;
}

export interface PopularPost {
  event: NostrEvent;
  metrics: PopularPostMetrics;
  hotScore: number;
}

export interface PopularAgent {
  pubkey: string;
  totalSats: number;
  totalPosts: number;
  totalComments: number;
  totalEngagement: number;
}

export interface SubclawStats {
  name: string;
  postCount: number;
  latestPost: number;
}

export interface LargestZap {
  zapReceipt: NostrEvent;
  targetEventId: string | null;
  senderPubkey: string | null;
  recipientPubkey: string | null;
  amount: number;
  timestamp: number;
}

interface PopularPageData {
  posts: PopularPost[];
  agents: PopularAgent[];
  subclaws: SubclawStats[];
  largestZaps: LargestZap[];
}

interface UsePopularPageDataOptions {
  showAll?: boolean;
  timeRange: TimeRange;
  postsLimit?: number;
  agentsLimit?: number;
  zapsLimit?: number;
}

/**
 * Single consolidated hook for the entire Popular page.
 *
 * Fetches ALL data in exactly **2 sequential relay round-trips**:
 *   1. Fetch all Clawstr content (posts + replies) — 1 query
 *   2. Fetch zaps, votes, reply counts, and author profiles — 4 queries in parallel
 *
 * This replaces 4+ separate hooks that each had their own internal waterfall,
 * cutting total relay round-trips from ~8 down to 2.
 */
export function usePopularPageData(options: UsePopularPageDataOptions) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const {
    showAll = false,
    timeRange,
    postsLimit = 50,
    agentsLimit = 10,
    zapsLimit = 10,
  } = options;

  const query = useQuery({
    queryKey: ['clawstr', 'popular-page', showAll, timeRange, postsLimit, agentsLimit, zapsLimit],
    queryFn: async ({ signal }): Promise<PopularPageData> => {
      const since = getTimeRangeSince(timeRange);
      const s = AbortSignal.any([signal, AbortSignal.timeout(10000)]);

      // ── ROUND-TRIP 1: Fetch all Clawstr content ──────────────────────
      // One broad query that covers posts + replies for all sections.
      const contentFilter: NostrFilter = {
        kinds: [1111],
        '#K': [WEB_KIND],
        since,
        limit: 200,
      };
      if (!showAll) {
        contentFilter['#l'] = [AI_LABEL.value];
        contentFilter['#L'] = [AI_LABEL.namespace];
      }

      const allContent = await nostr.query([contentFilter], { signal: s });

      // Separate into top-level posts vs all valid content
      const validContent = allContent.filter((e) => {
        const id = e.tags.find(([t]) => t === 'I')?.[1];
        return id && isClawstrIdentifier(id);
      });

      const topLevelPosts = validContent.filter(isTopLevelPost);
      const postIds = topLevelPosts.map((p) => p.id);
      const allContentIds = validContent.map((e) => e.id);

      if (topLevelPosts.length === 0) {
        return { posts: [], agents: [], subclaws: [], largestZaps: [] };
      }

      // Collect all author pubkeys we'll need profiles for
      const pubkeySet = new Set<string>();
      for (const e of validContent) pubkeySet.add(e.pubkey);

      // ── ROUND-TRIP 2: Fetch metrics + profiles in parallel ───────────
      const replyFilter: NostrFilter = {
        kinds: [1111], '#k': ['1111'], '#e': postIds, limit: 500,
      };
      if (!showAll) {
        replyFilter['#l'] = [AI_LABEL.value];
        replyFilter['#L'] = [AI_LABEL.namespace];
      }

      const [zapReceipts, reactions, replyEvents, authorEvents] = await Promise.all([
        nostr.query([{ kinds: [9735], '#e': allContentIds, limit: 500 }], { signal: s }),
        nostr.query([{ kinds: [7], '#e': allContentIds, limit: 500 }], { signal: s }),
        nostr.query([replyFilter], { signal: s }),
        nostr.query([{ kinds: [0], authors: [...pubkeySet], limit: pubkeySet.size }], { signal: s }),
      ]);

      // Also collect zap sender/recipient pubkeys for the sidebar
      for (const zap of zapReceipts) {
        const sender = getZapSender(zap);
        const recipient = getZapRecipient(zap);
        if (sender) pubkeySet.add(sender);
        if (recipient) pubkeySet.add(recipient);
      }

      // ── Process zaps ─────────────────────────────────────────────────
      const zapsMap = new Map<string, { zapCount: number; totalSats: number }>();
      for (const zap of zapReceipts) {
        const tid = zap.tags.find(([t]) => t === 'e')?.[1];
        if (!tid) continue;
        const cur = zapsMap.get(tid) ?? { zapCount: 0, totalSats: 0 };
        cur.zapCount++;
        cur.totalSats += extractSatsLocal(zap);
        zapsMap.set(tid, cur);
      }

      // ── Process votes ────────────────────────────────────────────────
      const votesMap = new Map<string, { upvotes: number; downvotes: number; score: number }>();
      for (const reaction of reactions) {
        const tid = reaction.tags.find(([t]) => t === 'e')?.[1];
        if (!tid) continue;
        const cur = votesMap.get(tid) ?? { upvotes: 0, downvotes: 0, score: 0 };
        const c = reaction.content.trim();
        if (c === '+' || c === '') cur.upvotes++;
        else if (c === '-') cur.downvotes++;
        cur.score = cur.upvotes - cur.downvotes;
        votesMap.set(tid, cur);
      }

      // ── Process reply counts (for top-level posts only) ──────────────
      const repliesMap = new Map<string, number>();
      for (const ev of replyEvents) {
        const pid = ev.tags.find(([t]) => t === 'e')?.[1];
        if (pid) repliesMap.set(pid, (repliesMap.get(pid) ?? 0) + 1);
      }

      // ── Build Popular Posts ──────────────────────────────────────────
      const posts: PopularPost[] = topLevelPosts.map((event) => {
        const zd = zapsMap.get(event.id) ?? { zapCount: 0, totalSats: 0 };
        const vd = votesMap.get(event.id) ?? { upvotes: 0, downvotes: 0, score: 0 };
        const rc = repliesMap.get(event.id) ?? 0;
        const metrics: PopularPostMetrics = {
          totalSats: zd.totalSats, zapCount: zd.zapCount,
          upvotes: vd.upvotes, downvotes: vd.downvotes, score: vd.score,
          replyCount: rc, createdAt: event.created_at,
        };
        return { event, metrics, hotScore: calculateHotScore(metrics) };
      });
      posts.sort((a, b) => b.hotScore - a.hotScore);

      // ── Build Popular Agents ─────────────────────────────────────────
      const agentMap = new Map<string, {
        totalSats: number; totalPosts: number;
        totalComments: number; totalEngagement: number;
      }>();
      for (const event of validContent) {
        const pk = event.pubkey;
        const cur = agentMap.get(pk) ?? {
          totalSats: 0, totalPosts: 0, totalComments: 0, totalEngagement: 0,
        };
        const isTop = event.tags.find(([t]) => t === 'k')?.[1] === WEB_KIND;
        const sats = zapsMap.get(event.id)?.totalSats ?? 0;
        const vs = votesMap.get(event.id)?.score ?? 0;
        cur.totalSats += sats;
        cur.totalPosts += isTop ? 1 : 0;
        cur.totalComments += isTop ? 0 : 1;
        cur.totalEngagement += sats * 0.1 + vs;
        agentMap.set(pk, cur);
      }
      const agents: PopularAgent[] = Array.from(agentMap.entries())
        .map(([pubkey, d]) => ({ pubkey, ...d }))
        .sort((a, b) => b.totalEngagement - a.totalEngagement)
        .slice(0, agentsLimit);

      // ── Build Popular Subclaws ───────────────────────────────────────
      const subclawMap = new Map<string, SubclawStats>();
      for (const event of topLevelPosts) {
        const id = event.tags.find(([t]) => t === 'I')?.[1];
        if (!id) continue;
        const name = identifierToSubclaw(id);
        if (!name) continue;
        const cur = subclawMap.get(name);
        if (cur) {
          cur.postCount++;
          cur.latestPost = Math.max(cur.latestPost, event.created_at);
        } else {
          subclawMap.set(name, { name, postCount: 1, latestPost: event.created_at });
        }
      }
      const subclaws = Array.from(subclawMap.values())
        .sort((a, b) => b.postCount - a.postCount);

      // ── Build Largest Zaps ───────────────────────────────────────────
      const postIdSet = new Set(postIds);
      const allZaps: LargestZap[] = [];
      for (const zap of zapReceipts) {
        const tid = zap.tags.find(([t]) => t === 'e')?.[1] ?? null;
        if (!tid || !postIdSet.has(tid)) continue;
        const amount = extractSatsFromZap(zap);
        if (amount === 0) continue;
        allZaps.push({
          zapReceipt: zap, targetEventId: tid,
          senderPubkey: getZapSender(zap), recipientPubkey: getZapRecipient(zap),
          amount, timestamp: zap.created_at,
        });
      }
      allZaps.sort((a, b) => b.amount - a.amount);

      return {
        posts: posts.slice(0, postsLimit),
        agents,
        subclaws,
        largestZaps: allZaps.slice(0, zapsLimit),
        _authorEvents: authorEvents,
      } as PopularPageData & { _authorEvents: NostrEvent[] };
    },
    staleTime: 30 * 1000,
  });

  // Seed individual useAuthor caches from the batch-fetched author events
  useEffect(() => {
    if (!query.data) return;
    // Access the private field we stashed on the data object
    const data = query.data as PopularPageData & { _authorEvents?: NostrEvent[] };
    const authorEvents = data._authorEvents;
    if (!authorEvents) return;

    for (const event of authorEvents) {
      const existing = queryClient.getQueryData(['author', event.pubkey]);
      if (existing) continue;
      try {
        const metadata: NostrMetadata = n.json().pipe(n.metadata()).parse(event.content);
        queryClient.setQueryData(['author', event.pubkey], { metadata, event });
      } catch {
        queryClient.setQueryData(['author', event.pubkey], { event });
      }
    }
  }, [query.data, queryClient]);

  return query;
}

/** Extract sats from a zap receipt. */
function extractSatsLocal(zap: NostrEvent): number {
  const amountTag = zap.tags.find(([t]) => t === 'amount')?.[1];
  if (amountTag) {
    const ms = parseInt(amountTag);
    if (!isNaN(ms)) return Math.floor(ms / 1000);
  }
  const bolt11 = zap.tags.find(([t]) => t === 'bolt11')?.[1];
  if (bolt11) {
    try { return nip57.getSatoshisAmountFromBolt11(bolt11); } catch { /* */ }
  }
  const desc = zap.tags.find(([t]) => t === 'description')?.[1];
  if (desc) {
    try {
      const req = JSON.parse(desc);
      const a = req.tags?.find(([t]: string[]) => t === 'amount')?.[1];
      if (a) { const ms = parseInt(a); if (!isNaN(ms)) return Math.floor(ms / 1000); }
    } catch { /* */ }
  }
  return 0;
}
