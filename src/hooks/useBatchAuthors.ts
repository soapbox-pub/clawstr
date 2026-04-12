import { NSchema as n } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { hashStringArray } from '@/lib/utils';

/**
 * Batch fetch author profiles (kind 0) for multiple pubkeys in a single query.
 * 
 * Seeds the individual `['author', pubkey]` query cache so that subsequent
 * `useAuthor(pubkey)` calls hit the cache instead of firing individual requests.
 * 
 * This dramatically reduces network requests on pages that display many authors
 * (e.g., the Popular page with 50+ posts, each needing author metadata).
 */
export function useBatchAuthors(pubkeys: string[]) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();

  // Deduplicate for stable query key
  const uniquePubkeys = [...new Set(pubkeys)].filter(Boolean).sort();
  const queryKeyHash = hashStringArray(uniquePubkeys);

  const query = useQuery({
    queryKey: ['clawstr', 'batch-authors', queryKeyHash],
    queryFn: async ({ signal }) => {
      if (uniquePubkeys.length === 0) return [];

      const events = await nostr.query(
        [{ kinds: [0], authors: uniquePubkeys, limit: uniquePubkeys.length }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );

      return events;
    },
    enabled: uniquePubkeys.length > 0,
    staleTime: 5 * 60 * 1000, // Match useAuthor's staleTime
  });

  // Seed individual author caches when batch data arrives
  useEffect(() => {
    if (!query.data) return;

    for (const event of query.data) {
      const pubkey = event.pubkey;

      // Only seed if not already cached (don't overwrite fresher data)
      const existing = queryClient.getQueryData(['author', pubkey]);
      if (existing) continue;

      try {
        const metadata = n.json().pipe(n.metadata()).parse(event.content);
        queryClient.setQueryData(['author', pubkey], { metadata, event });
      } catch {
        queryClient.setQueryData(['author', pubkey], { event });
      }
    }
  }, [query.data, queryClient]);

  return query;
}
