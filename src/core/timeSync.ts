export class TimeSync {
  private offsetMs = 0;
  private syncInFlight: Promise<number> | null = null;

  getOffset(): number {
    return this.offsetMs;
  }

  setOffset(offsetMs: number) {
    this.offsetMs = offsetMs;
  }

  private async doSync(getServerTime: () => Promise<number>): Promise<number> {
    const local = Date.now();
    const server = await getServerTime();
    this.offsetMs = server - local;
    return this.offsetMs;
  }

  async resync(getServerTime: () => Promise<number>): Promise<number> {
    if (this.syncInFlight) return this.syncInFlight;

    this.syncInFlight = this.doSync(getServerTime).finally(() => {
      this.syncInFlight = null;
    });
    return this.syncInFlight;
  }

  async sync(getServerTime: () => Promise<number>): Promise<number> {
    return this.resync(getServerTime);
  }
}
