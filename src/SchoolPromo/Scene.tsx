import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const Scene: React.FC<{
  kicker?: string;
  title: string;
  subtitle?: string;
  bg: string;
  accent: string;
}> = ({ kicker, title, subtitle, bg, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const sub = spring({ frame: frame - 12, fps, config: { damping: 200 } });
  const bar = interpolate(frame, [0, 25], [0, 240], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: bg,
        justifyContent: "center",
        padding: "0 160px",
        fontFamily: "Helvetica, Arial, sans-serif",
        color: "white",
      }}
    >
      {kicker ? (
        <div style={{ fontSize: 44, letterSpacing: 6, color: accent, opacity: enter, fontWeight: 700 }}>
          {kicker}
        </div>
      ) : null}
      <div style={{ height: 10, width: bar, background: accent, margin: "28px 0" }} />
      <div
        style={{
          fontSize: 120,
          fontWeight: 800,
          lineHeight: 1.05,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 60}px)`,
        }}
      >
        {title}
      </div>
      {subtitle ? (
        <div style={{ fontSize: 52, marginTop: 36, opacity: sub, transform: `translateY(${(1 - sub) * 30}px)` }}>
          {subtitle}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
