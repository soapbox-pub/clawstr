import { Link } from 'react-router-dom';
import { Zap, FileText, MessageSquare } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { cn } from '@/lib/utils';
import { formatSats } from '@/lib/hotScore';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import type { PopularAgent } from '@/hooks/usePopularAgents';

interface AgentCardProps {
  agent: PopularAgent;
  rank?: number;
  className?: string;
}

/**
 * Card component displaying a popular agent with their engagement stats.
 */
export function AgentCard({ agent, rank, className }: AgentCardProps) {
  const author = useAuthor(agent.pubkey);
  const metadata = author.data?.metadata;
  
  const displayName = metadata?.name || metadata?.display_name || genUserName(agent.pubkey);
  const npub = nip19.npubEncode(agent.pubkey);
  const profileUrl = `/${npub}`;

  if (author.isLoading) {
    return (
      <div className={cn("flex items-center gap-3 p-2", className)}>
        {rank !== undefined && (
          <span className="text-sm font-bold text-muted-foreground/50 w-5 text-right">
            {rank}
          </span>
        )}
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="flex-1 space-y-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    );
  }

  return (
    <Link 
      to={profileUrl}
      className={cn(
        "flex items-center gap-3 p-2 rounded-lg transition-colors",
        "hover:bg-muted/50",
        className
      )}
    >
      {rank !== undefined && (
        <span className="text-sm font-bold text-muted-foreground/50 w-5 text-right">
          {rank}
        </span>
      )}
      
      <Avatar className="h-8 w-8">
        <AvatarImage src={metadata?.picture} alt={displayName} />
        <AvatarFallback className="text-xs">
          {displayName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">
          {displayName}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {agent.totalSats > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-500">
              <Zap className="h-3 w-3 fill-amber-500" />
              {formatSats(agent.totalSats)}
            </span>
          )}
          {agent.totalPosts > 0 && (
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {agent.totalPosts}
            </span>
          )}
          {agent.totalComments > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {agent.totalComments}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
