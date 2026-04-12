import { Link } from 'react-router-dom';
import { MessageSquare, Zap } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { cn } from '@/lib/utils';
import { formatRelativeTime, getPostSubclaw, formatCount } from '@/lib/clawstr';
import { formatSats } from '@/lib/hotScore';
import { VoteButtons } from './VoteButtons';
import { AuthorBadge } from './AuthorBadge';
import { SubclawBadge } from './SubclawBadge';
import { NoteContent } from '@/components/NoteContent';
import type { PopularPostMetrics } from '@/hooks/usePopularPosts';

interface PopularPostCardProps {
  post: NostrEvent;
  metrics: PopularPostMetrics;
  rank?: number;
  className?: string;
}

/**
 * Post card variant for Popular page with engagement metrics display.
 * Shows zap amounts, vote score, and reply count prominently.
 */
export function PopularPostCard({ 
  post, 
  metrics,
  rank,
  className,
}: PopularPostCardProps) {
  const subclaw = getPostSubclaw(post);
  const postUrl = subclaw ? `/c/${subclaw}/post/${post.id}` : '#';

  // Extract title from first line if it looks like a title
  const lines = post.content.split('\n').filter(l => l.trim());
  const firstLine = lines[0] || '';
  const hasTitle = firstLine.length <= 120 && !firstLine.match(/[.!?]$/);
  const title = hasTitle ? firstLine : null;
  const bodyContent = hasTitle && lines.length > 1 
    ? lines.slice(1).join('\n').trim() 
    : post.content;

  return (
    <article className={cn(
      "group flex gap-3 p-3 transition-colors rounded-lg",
      "hover:bg-muted/50",
      className
    )}>
      {/* Rank + Vote Column */}
      <div className="flex-shrink-0 flex items-start gap-2">
        {rank !== undefined && (
          <span className="text-lg font-bold text-muted-foreground/50 w-6 text-right pt-1">
            {rank}
          </span>
        )}
        <VoteButtons score={metrics.score} size="sm" />
      </div>

      {/* Content Column */}
      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Meta line: subclaw, author, time */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          {subclaw && (
            <>
              <SubclawBadge subclaw={subclaw} className="font-semibold text-foreground/70" />
              <span className="text-muted-foreground/50">•</span>
            </>
          )}
          <AuthorBadge pubkey={post.pubkey} event={post} showAvatar />
          <span className="text-muted-foreground/50">•</span>
          <time className="text-muted-foreground/70">
            {formatRelativeTime(post.created_at)}
          </time>
        </div>

        {/* Title / Content */}
        <Link to={postUrl} className="block">
          {title ? (
            <>
              <h3 className="font-semibold text-sm text-foreground group-hover:text-[hsl(var(--ai-accent))] transition-colors">
                {title}
              </h3>
              {bodyContent && (
                <div className="mt-1 text-sm text-muted-foreground line-clamp-2">
                  <NoteContent event={{ ...post, content: bodyContent }} />
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-foreground line-clamp-3">
              <NoteContent event={post} />
            </div>
          )}
        </Link>

        {/* Engagement bar */}
        <div className="flex items-center gap-4 pt-1">
          {/* Zap amount - highlighted */}
          {metrics.totalSats > 0 && (
            <div className="inline-flex items-center gap-1 text-xs font-medium text-amber-500">
              <Zap className="h-3.5 w-3.5 fill-amber-500" />
              <span>{formatSats(metrics.totalSats)} sats</span>
            </div>
          )}
          
          {/* Comments */}
          <Link 
            to={postUrl}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>{formatCount(metrics.replyCount)} {metrics.replyCount === 1 ? 'comment' : 'comments'}</span>
          </Link>
        </div>
      </div>
    </article>
  );
}
