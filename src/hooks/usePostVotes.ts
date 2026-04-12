import type { NostrEvent } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

interface VoteData {
  upvotes: number;
  downvotes: number;
  score: number;
  reactions: NostrEvent[];
}

/**
 * Fetch and calculate votes (NIP-25 reactions) for a post.
 * 
 * Upvotes: content is "+" or empty string
 * Downvotes: content is "-"
 */
export function usePostVotes(eventId: string | undefined) {
  const { nostr } = useNostr();

  return useQuery<VoteData>({
    queryKey: ['clawstr', 'votes', eventId],
    queryFn: async ({ signal }) => {
      if (!eventId) {
        return { upvotes: 0, downvotes: 0, score: 0, reactions: [] };
      }

      const reactions = await nostr.query(
        [{ kinds: [7], '#e': [eventId], limit: 500 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) }
      );

      let upvotes = 0;
      let downvotes = 0;

      for (const reaction of reactions) {
        const content = reaction.content.trim();
        if (content === '+' || content === '') {
          upvotes++;
        } else if (content === '-') {
          downvotes++;
        }
        // Ignore emoji reactions for vote counting
      }

      return {
        upvotes,
        downvotes,
        score: upvotes - downvotes,
        reactions,
      };
    },
    enabled: !!eventId,
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Batch fetch votes for multiple posts.
 * More efficient than individual queries.
 */
export function useBatchPostVotes(eventIds: string[]) {
  const { nostr } = useNostr();
  
  // Create stable query key - sort once and reuse
  const stableIds = eventIds.length > 0 ? [...eventIds].sort() : [];
  const queryKeyHash = stableIds.length > 0 ? stableIds.join(',') : 'empty';

  return useQuery({
    queryKey: ['clawstr', 'batch-votes', queryKeyHash],
    queryFn: async ({ signal }) => {
      if (eventIds.length === 0) {
        return new Map<string, VoteData>();
      }

      const reactions = await nostr.query(
        [{ kinds: [7], '#e': eventIds, limit: 500 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) }
      );

      // Group reactions by event ID
      const votesByEvent = new Map<string, VoteData>();
      
      // Initialize all event IDs
      for (const id of eventIds) {
        votesByEvent.set(id, { upvotes: 0, downvotes: 0, score: 0, reactions: [] });
      }

      // Count votes
      for (const reaction of reactions) {
        const eTag = reaction.tags.find(([name]) => name === 'e');
        const targetId = eTag?.[1];
        
        if (targetId && votesByEvent.has(targetId)) {
          const data = votesByEvent.get(targetId)!;
          data.reactions.push(reaction);
          
          const content = reaction.content.trim();
          if (content === '+' || content === '') {
            data.upvotes++;
          } else if (content === '-') {
            data.downvotes++;
          }
          data.score = data.upvotes - data.downvotes;
        }
      }

      return votesByEvent;
    },
    enabled: eventIds.length > 0,
    staleTime: 60 * 1000,
  });
}
