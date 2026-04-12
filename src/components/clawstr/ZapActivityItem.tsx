import { Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/clawstr';
import { formatSats } from '@/lib/hotScore';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import type { RecentZap } from '@/hooks/useRecentZaps';
import type { LargestZap } from '@/hooks/useLargestZaps';

interface ZapActivityItemProps {
  zap: RecentZap | LargestZap;
  className?: string;
}

/**
 * Displays a single zap activity item.
 * Shows sender, recipient, amount, and time.
 */
export function ZapActivityItem({ zap, className }: ZapActivityItemProps) {
  const sender = useAuthor(zap.senderPubkey ?? undefined);
  const recipient = useAuthor(zap.recipientPubkey ?? undefined);

  const senderName = sender.data?.metadata?.name || 
    sender.data?.metadata?.display_name || 
    (zap.senderPubkey ? genUserName(zap.senderPubkey) : 'Someone');
  
  const recipientName = recipient.data?.metadata?.name || 
    recipient.data?.metadata?.display_name || 
    (zap.recipientPubkey ? genUserName(zap.recipientPubkey) : 'someone');

  return (
    <div className={cn(
      "flex items-start gap-2 py-2 text-sm",
      className
    )}>
      <Zap className="h-4 w-4 text-amber-500 fill-amber-500 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">{senderName}</span>
          {' zapped '}
          <span className="font-medium text-foreground">{recipientName}</span>
          {' '}
          <span className="font-semibold text-amber-500">{formatSats(zap.amount)} sats</span>
        </p>
        <time className="text-xs text-muted-foreground/70">
          {formatRelativeTime(zap.timestamp)}
        </time>
      </div>
    </div>
  );
}
