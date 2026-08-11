import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const commonProps = {
  "aria-hidden": true,
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.8,
  viewBox: "0 0 24 24"
};

export function DatabaseIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <ellipse cx="12" cy="5" rx="7.5" ry="3" />
      <path d="M4.5 5v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V5M4.5 10v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5M4.5 15v4c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-4" />
    </svg>
  );
}

export function CloudIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="M7.4 18.5h10.1a4 4 0 0 0 .2-8 6.2 6.2 0 0 0-12-1.6 4.8 4.8 0 0 0 1.7 9.6Z" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="M10.3 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01" />
    </svg>
  );
}

export function EmptyIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4.5 4.5M8.5 10.5h4" />
    </svg>
  );
}
