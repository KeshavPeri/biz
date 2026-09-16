export type ChatAttachmentTicket = Readonly<{
  context: string;
  generation: number;
  messageId?: string;
}>;

/** Invalidates every private async result when account, deal, or terminal state changes. */
export class ChatAttachmentContextFence {
  private context = '';
  private generation = 0;

  switchContext(context: string): void {
    if (context !== this.context) {
      this.context = context;
      this.generation += 1;
    }
  }

  invalidate(): void {
    this.generation += 1;
  }

  begin(context: string, messageId?: string): ChatAttachmentTicket {
    return { context, generation: this.generation, messageId };
  }

  isCurrent(ticket: ChatAttachmentTicket, messageId?: string): boolean {
    return ticket.context === this.context
      && ticket.generation === this.generation
      && (messageId === undefined || ticket.messageId === messageId);
  }
}
