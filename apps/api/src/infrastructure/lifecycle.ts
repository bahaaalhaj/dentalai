export class ApplicationLifecycle {
  private draining = false;

  beginShutdown(): void {
    this.draining = true;
  }

  isAcceptingTraffic(): boolean {
    return !this.draining;
  }
}
