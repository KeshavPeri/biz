export type PostCloseRequestTicket = Readonly<{
  context: string;
  generation: number;
}>;

/**
 * Synchronously invalidates work started for an earlier deal/stage/account.
 * One instance belongs to one mounted post-close surface.
 */
export class PostCloseContextFence {
  private context = '';
  private generation = 0;

  switchContext(context: string): boolean {
    if (context === this.context) return false;
    this.context = context;
    this.generation += 1;
    return true;
  }

  begin(context: string): PostCloseRequestTicket {
    return { context, generation: this.generation };
  }

  isCurrent(ticket: PostCloseRequestTicket): boolean {
    return ticket.context === this.context && ticket.generation === this.generation;
  }

  isContextCurrent(context: string): boolean {
    return context === this.context;
  }
}

export function forPostCloseContext<T>(
  currentContext: string,
  stateContext: string,
  value: T,
  clearedValue: T,
): T {
  return currentContext === stateContext ? value : clearedValue;
}
