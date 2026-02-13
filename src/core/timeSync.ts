export class TimeSync {
  private offsetMs = 0;

  getOffset(): number {
    return this.offsetMs;
  }

  setOffset(offsetMs: number) {
    this.offsetMs = offsetMs;
  }

  async sync(getServerTime: () => Promise<number>): Promise<number> {
    const local = Date.now();
    const server = await getServerTime();
    this.offsetMs = server - local;
    return this.offsetMs;
  }
}
