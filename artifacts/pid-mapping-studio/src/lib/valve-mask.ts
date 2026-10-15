export type ValveMaskPoint = [number, number];

const MAX_MASK_VERTICES = 128;
const EPSILON = 1e-9;

function cross(a: ValveMaskPoint, b: ValveMaskPoint, c: ValveMaskPoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: ValveMaskPoint, b: ValveMaskPoint, p: ValveMaskPoint): boolean {
  return Math.abs(cross(a, b, p)) <= EPSILON &&
    p[0] >= Math.min(a[0], b[0]) - EPSILON &&
    p[0] <= Math.max(a[0], b[0]) + EPSILON &&
    p[1] >= Math.min(a[1], b[1]) - EPSILON &&
    p[1] <= Math.max(a[1], b[1]) + EPSILON;
}

function segmentsIntersect(
  a: ValveMaskPoint,
  b: ValveMaskPoint,
  c: ValveMaskPoint,
  d: ValveMaskPoint,
): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (
    ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
    ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))
  ) return true;
  return (Math.abs(abC) <= EPSILON && onSegment(a, b, c)) ||
    (Math.abs(abD) <= EPSILON && onSegment(a, b, d)) ||
    (Math.abs(cdA) <= EPSILON && onSegment(c, d, a)) ||
    (Math.abs(cdB) <= EPSILON && onSegment(c, d, b));
}

function polygonArea(points: ValveMaskPoint[]): number {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

/**
 * Parses an ordered local-coordinate outline: "x,y; x,y; x,y".
 * The polygon closes automatically; callers must not add pipe tails or a
 * broad bounding rectangle around the valve.
 */
export function parseValveMaskBoundary(value: string): ValveMaskPoint[] {
  const pairs = value.split(';').map((pair) => pair.trim()).filter(Boolean);
  if (pairs.length < 3 || pairs.length > MAX_MASK_VERTICES) {
    throw new Error(`Enter 3-${MAX_MASK_VERTICES} valve-body outline points.`);
  }

  const points = pairs.map((pair, index) => {
    const components = pair.split(',').map((part) => part.trim());
    if (components.length !== 2 || !components[0] || !components[1]) {
      throw new Error(`Mask point ${index + 1} must be written as X,Y.`);
    }
    const point: ValveMaskPoint = [Number(components[0]), Number(components[1])];
    if (!point.every(Number.isFinite)) {
      throw new Error(`Mask point ${index + 1} must contain finite X,Y values.`);
    }
    return point;
  });

  if (
    points.some((point, index) => {
      const next = points[(index + 1) % points.length];
      return Math.hypot(point[0] - next[0], point[1] - next[1]) <= EPSILON;
    })
  ) {
    throw new Error('The valve mask outline cannot contain duplicate adjacent points.');
  }

  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (
        first === second ||
        firstNext === second ||
        secondNext === first
      ) continue;
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) {
        throw new Error('The valve mask outline must not cross or touch itself.');
      }
    }
  }

  if (Math.abs(polygonArea(points)) <= EPSILON) {
    throw new Error('The valve mask outline must enclose an area.');
  }
  return points;
}

export function valveMaskPointsToLisp(points: ValveMaskPoint[]): string {
  return `(${points.map(([x, y]) => `(${x} ${y})`).join(' ')})`;
}

