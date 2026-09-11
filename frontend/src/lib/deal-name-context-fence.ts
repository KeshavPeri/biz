export type DealNameRequestTicket = {
  identity: string;
  generation: number;
  displayedVersion: number | null;
};

/** Synchronously invalidates late rename work when account/deal context changes. */
export class DealNameContextFence {
  private identity = '';
  private generation = 0;

  switchContext(identity: string): void {
    if (this.identity === identity) return;
    this.identity = identity;
    this.generation += 1;
  }

  begin(identity: string, displayedVersion: number | null): DealNameRequestTicket {
    return { identity, generation: this.generation, displayedVersion };
  }

  isCurrent(ticket: DealNameRequestTicket, displayedVersion: number | null): boolean {
    return ticket.identity === this.identity
      && ticket.generation === this.generation
      && ticket.displayedVersion === displayedVersion;
  }

  isIdentityCurrent(ticket: DealNameRequestTicket): boolean {
    return ticket.identity === this.identity && ticket.generation === this.generation;
  }
}
