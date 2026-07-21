/**
 * Minimal geometric "S" mark: five rectangles forming a bold stencil-style S
 * (top bar → left connector down → middle bar → right connector down →
 * bottom bar). Pure black fill, transparent background, no gradients,
 * shadows, borders, or enclosing shape — matches the favicon geometry
 * exactly so the browser tab icon and in-app mark are identical.
 */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="2" width="16" height="4" fill="#000000" />
      <rect x="4" y="2" width="4" height="11" fill="#000000" />
      <rect x="4" y="9" width="16" height="4" fill="#000000" />
      <rect x="16" y="9" width="4" height="13" fill="#000000" />
      <rect x="4" y="18" width="16" height="4" fill="#000000" />
    </svg>
  );
}
