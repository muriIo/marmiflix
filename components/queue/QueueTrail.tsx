const DOTS = [
  { cx: 20, distance: 4 },
  { cx: 62, distance: 3 },
  { cx: 104, distance: 2 },
  { cx: 146, distance: 1, r: 7 },
];

export function QueueTrail({ aheadCount }: { aheadCount: number }) {
  const isNext = aheadCount === 0;

  return (
    <svg
      viewBox="0 0 200 90"
      className="mx-auto mb-2 h-24 w-full max-w-[210px] overflow-visible"
      aria-hidden="true"
    >
      <path
        d="M20,45 H165"
        fill="none"
        strokeWidth="2"
        strokeDasharray="4 6"
        className={`opacity-60 ${
          isNext ? "stroke-alarm-500 animate-trail-dash-fast" : "stroke-char-600 animate-trail-dash"
        }`}
      />

      {DOTS.map((dot) => {
        const active = aheadCount >= dot.distance;
        return (
          <circle
            key={dot.cx}
            cx={dot.cx}
            cy={45}
            r={dot.r ?? 6}
            className={`fill-char-600 transition-opacity duration-500 ${
              active ? "opacity-100" : "opacity-25"
            }`}
          />
        );
      })}

      <circle
        cx={172}
        cy={45}
        r={8}
        strokeWidth="1.5"
        style={{ transformOrigin: "172px 45px" }}
        className={`stroke-ember-600 transition-colors duration-300 ${
          isNext ? "fill-alarm-500 animate-dot-breathe-fast" : "fill-amber-500 animate-dot-breathe"
        }`}
      />
    </svg>
  );
}
