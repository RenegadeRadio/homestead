export interface BrowserStatus {
  running: boolean;
  mode: "bot" | "human";
  url: string;
  title: string;
  takeoverReason: string;
  width: number;
  height: number;
}
