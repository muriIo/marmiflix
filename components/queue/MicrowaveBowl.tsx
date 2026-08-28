const CURLS = [
  { d: "M68,50 Q60,40 68,32 Q76,24 68,16", delay: "0s" },
  { d: "M80,48 Q72,38 80,30 Q88,22 80,14", delay: "1.05s" },
  { d: "M92,50 Q84,40 92,32 Q100,24 92,16", delay: "2.1s" },
];

const SPARKS = [
  { cx: 54, cy: 40, r: 2, delay: "0s" },
  { cx: 108, cy: 46, r: 2, delay: "0.6s" },
  { cx: 100, cy: 66, r: 1.6, delay: "1.2s" },
];

export function MicrowaveBowl({ isUrgent }: { isUrgent: boolean }) {
  const curlColor = isUrgent ? "stroke-alarm-500" : "stroke-cream-300";
  const curlAnimation = isUrgent ? "animate-curl-rise-urgent" : "animate-curl-rise";
  const bowlAnimation = isUrgent ? "animate-bowl-shake" : "animate-bowl-bounce";

  return (
    <svg
      viewBox="0 0 160 120"
      className="mx-auto mb-2 h-32 w-full max-w-[190px] overflow-visible"
      aria-hidden="true"
    >
      {CURLS.map((curl) => (
        <path
          key={curl.d}
          d={curl.d}
          fill="none"
          strokeWidth="2.2"
          strokeLinecap="round"
          className={`opacity-0 [transform-box:fill-box] [transform-origin:50%_100%] ${curlAnimation} ${curlColor}`}
          style={{ animationDelay: curl.delay }}
        />
      ))}

      {SPARKS.map((spark) => (
        <circle
          key={`${spark.cx}-${spark.cy}`}
          cx={spark.cx}
          cy={spark.cy}
          r={spark.r}
          className="animate-twinkle fill-amber-300"
          style={{ animationDelay: spark.delay }}
        />
      ))}

      <g className={bowlAnimation} style={{ transformOrigin: "80px 92px" }}>
        <ellipse cx="80" cy="94" rx="34" ry="8" className="fill-char-950" opacity="0.3" />
        <path
          d="M46,72 Q80,60 114,72 L108,88 Q80,98 52,88 Z"
          fill="url(#microwave-bowl-gradient)"
          className="stroke-ember-600"
          strokeWidth="1.5"
        />
        <ellipse
          cx="80"
          cy="72"
          rx="34"
          ry="9"
          className="fill-amber-300 stroke-ember-600"
          strokeWidth="1.5"
        />
        <ellipse cx="80" cy="72" rx="24" ry="5.5" className="fill-char-900" opacity="0.35" />
      </g>

      <defs>
        <linearGradient id="microwave-bowl-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={isUrgent ? "#FF4141" : "#FFB020"} />
          <stop offset="100%" stopColor="#E4610A" />
        </linearGradient>
      </defs>
    </svg>
  );
}
