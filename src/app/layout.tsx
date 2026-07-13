import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import AutoUpdateController from "@/components/AutoUpdateController";
import AutoReportController from "@/components/AutoReportController";
import WatchlistController from "@/components/WatchlistController";
import ScreenerAutoController from "@/components/ScreenerAutoController";
import SignalEngineController from "@/components/SignalEngineController";
import { APP_LABEL } from "@/lib/version";

export const metadata: Metadata = {
  title: "JARVIS Trade Log",
  description: "Personal stock operations console",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="font-display">
        <AutoUpdateController />
        <AutoReportController />
        <WatchlistController />
        <ScreenerAutoController />
        <SignalEngineController />
        <div className="max-w-7xl mx-auto px-4 pb-16">
          <header className="flex items-end justify-between py-5 border-b border-line mb-6">
            <div>
              <h1 className="text-2xl font-bold tracking-[0.3em] text-arc">
                J.A.R.V.I.S <span className="text-arcdim">/ TRADE LOG</span>
              </h1>
              <p className="hud-label mt-1">Stock Operations Console — Manual Feed Mode</p>
            </div>
            <Nav />
          </header>
          {children}
          <footer className="mt-10 pt-4 border-t border-line text-center">
            <p className="hud-label text-arcdim">
              {APP_LABEL} — 完全ローカル運用 / 判断補助ツール（投資助言ではありません）
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
