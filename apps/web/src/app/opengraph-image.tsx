import { ImageResponse } from "next/og";

export const alt = "YCAReach: cold email that sounds like you, from your own inbox";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BLUE = "#165dfc";

/** Social share card (shown when a link to the site is pasted into chat or social apps). */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "#ffffff",
          color: "#0a0a0a",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width="88" height="88" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="8" fill={BLUE} />
            <path d="M9.5 9 16 17v7" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 17 22 9.6" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" opacity="0.55" />
            <circle cx="23" cy="8.6" r="2.6" fill="#fff" />
          </svg>
          <div style={{ display: "flex", fontSize: 56, fontWeight: 700, letterSpacing: -2 }}>
            YCA<span style={{ color: BLUE }}>Reach</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.08, letterSpacing: -3, maxWidth: 980 }}>
            Cold email that sounds like you, from your own inbox.
          </div>
          <div style={{ display: "flex", fontSize: 34, color: "#525252" }}>Free 7-day trial. No card needed.</div>
        </div>
      </div>
    ),
    size,
  );
}
