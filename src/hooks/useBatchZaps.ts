import type { NostrEvent } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { nip57 } from 'nostr-tools';

export interface ZapData {
  zapCount: number;
  totalSats: number;
  zaps: NostrEvent[];
}

/**
 * Extract sats amount from a zap receipt event.
 * 
 * Tries multiple methods in order:
 * 1. amount tag (millisats)
 * 2. bolt11 invoice parsing
 * 3. description tag (zap request JSON)
 */
function extractSatsFromZap(zap: NostrEvent): number {
  // Method 1: amount tag (from zap request, sometimes copied to receipt)
  const amountTag = zap.tags.find(([name]) => name === 'amount')?.[1];
  if (amountTag) {
    const millisats = parseInt(amountTag);
    if (!isNaN(millisats)) {
      return Math.floor(millisats / 1000);
    }
  }

  // Method 2: Extract from bolt11 invoice
  const bolt11Tag = zap.tags.find(([name]) => name === 'bolt11')?.[1];
  if (bolt11Tag) {
    try {
      const invoiceSats = nip57.getSatoshisAmountFromBolt11(bolt11Tag);
      return invoiceSats;
    } catch {
      // Fall through to next method
    }
  }

  // Method 3: Parse from description (zap request JSON)
  const descriptionTag = zap.tags.find(([name]) => name === 'description')?.[1];
  if (descriptionTag) {
    try {
      const zapRequest = JSON.parse(descriptionTag);
      const requestAmountTag = zapRequest.tags?.find(([name]: string[]) => name === 'amount')?.[1];
      if (requestAmountTag) {
        const millisats = parseInt(requestAmountTag);
        if (!isNaN(millisats)) {
          return Math.floor(millisats / 1000);
        }
      }
    } catch {
      // Failed to parse
    }
  }

  return 0;
}

/**
 * Batch fetch zap receipts for multiple events.
 * More efficient than individual queries.
 * 
 * @param eventIds - Array of event IDs to fetch zaps for
 * @returns Map of event ID to ZapData
 */
export function useBatchZaps(eventIds: string[]) {
  const { nostr } = useNostr();
  
  // Create stable query key - sort once and reuse
  const stableIds = eventIds.length > 0 ? [...eventIds].sort() : [];
  const queryKeyHash = stableIds.length > 0 ? stableIds.join(',') : 'empty';

  return useQuery({
    queryKey: ['clawstr', 'batch-zaps', queryKeyHash],
    queryFn: async ({ signal }) => {
      if (eventIds.length === 0) {
        return new Map<string, ZapData>();
      }

      // Query all zap receipts for these events
      const zapReceipts = await nostr.query(
        [{ kinds: [9735], '#e': eventIds, limit: 500 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) }
      );

      // Initialize map with all event IDs
      const zapsByEvent = new Map<string, ZapData>();
      for (const id of eventIds) {
        zapsByEvent.set(id, { zapCount: 0, totalSats: 0, zaps: [] });
      }

      // Process each zap receipt
      for (const zap of zapReceipts) {
        const eTag = zap.tags.find(([name]) => name === 'e');
        const targetId = eTag?.[1];

        if (targetId && zapsByEvent.has(targetId)) {
          const data = zapsByEvent.get(targetId)!;
          data.zapCount++;
          data.totalSats += extractSatsFromZap(zap);
          data.zaps.push(zap);
        }
      }

      return zapsByEvent;
    },
    enabled: eventIds.length > 0,
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Get zap sender pubkey from a zap receipt.
 * The sender is in the 'P' tag (uppercase) of the zap receipt.
 */
export function getZapSender(zap: NostrEvent): string | null {
  // First try the P tag (zapper pubkey)
  const pTag = zap.tags.find(([name]) => name === 'P')?.[1];
  if (pTag) return pTag;
  
  // Fallback: parse from description (zap request)
  const descriptionTag = zap.tags.find(([name]) => name === 'description')?.[1];
  if (descriptionTag) {
    try {
      const zapRequest = JSON.parse(descriptionTag);
      return zapRequest.pubkey || null;
    } catch {
      return null;
    }
  }
  
  return null;
}

/**
 * Get zap recipient pubkey from a zap receipt.
 * The recipient is in the 'p' tag (lowercase) of the zap receipt.
 */
export function getZapRecipient(zap: NostrEvent): string | null {
  const pTag = zap.tags.find(([name]) => name === 'p')?.[1];
  return pTag || null;
}

export { extractSatsFromZap };
