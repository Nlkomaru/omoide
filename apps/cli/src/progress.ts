import readline from "node:readline";

export interface ProgressBarOptions {
  total: number;
  width?: number;
  title?: string;
}

export class CliProgressBar {
  private total: number;
  private current = 0;
  private width: number;
  private title: string;
  private isTty: boolean;
  private startTime: number;
  private lastRenderTime = 0;

  constructor(options: ProgressBarOptions) {
    this.total = Math.max(1, options.total);
    this.width = options.width ?? 30;
    this.title = options.title ?? "Progress";
    this.isTty = Boolean(process.stdout.isTTY);
    this.startTime = Date.now();
  }

  public increment(step = 1, currentItemInfo?: string): void {
    this.current = Math.min(this.total, this.current + step);
    this.render(currentItemInfo);
  }

  public update(current: number, currentItemInfo?: string): void {
    this.current = Math.min(this.total, current);
    this.render(currentItemInfo);
  }

  public logAbove(message: string): void {
    if (this.isTty) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(message);
      this.render();
    } else {
      console.log(message);
    }
  }

  public render(info?: string): void {
    const now = Date.now();
    // Throttle TTY redraws to max 25 fps, unless at complete or step is big
    if (this.isTty && this.current < this.total && now - this.lastRenderTime < 40) {
      return;
    }
    this.lastRenderTime = now;

    const percent = Math.min(100, Math.round((this.current / this.total) * 100));
    const filled = Math.min(this.width, Math.round((this.current / this.total) * this.width));
    const empty = Math.max(0, this.width - filled);
    const bar = "█".repeat(filled) + "░".repeat(empty);

    const elapsedSec = Math.max(0.1, (now - this.startTime) / 1000);
    const rate = this.current / elapsedSec;
    const remainingSec = rate > 0 ? Math.round((this.total - this.current) / rate) : 0;
    const remainingStr =
      remainingSec > 60
        ? `${Math.floor(remainingSec / 60)}m${remainingSec % 60}s`
        : `${remainingSec}s`;

    const statusLine = `${this.title} [${bar}] ${percent}% (${this.current}/${this.total}) ~${remainingStr} left${
      info ? ` | ${info}` : ""
    }`;

    if (this.isTty) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(statusLine);
      if (this.current >= this.total) {
        process.stdout.write("\n");
      }
    } else if (this.current >= this.total || this.current === 1 || this.current % 50 === 0) {
      console.log(statusLine);
    }
  }

  public complete(message?: string): void {
    this.current = this.total;
    if (this.isTty) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      if (message) console.log(message);
    } else if (message) {
      console.log(message);
    }
  }
}
