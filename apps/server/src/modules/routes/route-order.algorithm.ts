import { RouteOrderResultSchema } from '@travel-guide/shared-schemas';
import type {
  RouteEstimate,
  RouteMatrixCell,
  RouteMatrixResult,
  RouteOrderLeg,
  RouteOrderResult,
} from '@travel-guide/shared-types';

export type RouteOrderAlgorithmErrorCode =
  'ROUTE_ORDER_VALIDATION_ERROR' | 'ROUTE_ORDER_UNAVAILABLE';

export class RouteOrderAlgorithmError extends Error {
  public constructor(
    public readonly code: RouteOrderAlgorithmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RouteOrderAlgorithmError';
  }
}

const compareIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const pairKey = (originId: string, destinationId: string): string =>
  `${originId}\u0000${destinationId}`;

const availableEstimate = (cell: RouteMatrixCell | undefined): RouteEstimate | undefined => {
  if (cell === undefined || cell.status !== 'available' || cell.estimate === undefined) {
    return undefined;
  }
  return cell.estimate.dataSource === 'unavailable' ? undefined : cell.estimate;
};

const compareCandidates = (
  left: { id: string; estimate: RouteEstimate },
  right: { id: string; estimate: RouteEstimate },
): number => {
  if (left.estimate.dataSource === 'unavailable' || right.estimate.dataSource === 'unavailable') {
    return compareIds(left.id, right.id);
  }
  if (left.estimate.durationSeconds !== right.estimate.durationSeconds) {
    return left.estimate.durationSeconds - right.estimate.durationSeconds;
  }
  if (left.estimate.distanceMeters !== right.estimate.distanceMeters) {
    return left.estimate.distanceMeters - right.estimate.distanceMeters;
  }
  return compareIds(left.id, right.id);
};

/**
 * Build a deterministic nearest-neighbor order from a real route matrix.
 * The result is intentionally a heuristic and is not guaranteed to be globally optimal.
 */
export const calculateNearestNeighborOrder = (
  matrix: RouteMatrixResult,
  startId?: string,
  endId?: string,
): RouteOrderResult => {
  const pointIds = matrix.points.map((point) => point.id);
  const uniquePointIds = new Set(pointIds);
  if (pointIds.length < 2 || uniquePointIds.size !== pointIds.length) {
    throw new RouteOrderAlgorithmError(
      'ROUTE_ORDER_VALIDATION_ERROR',
      'Route matrix points are invalid',
    );
  }
  if (startId !== undefined && !uniquePointIds.has(startId)) {
    throw new RouteOrderAlgorithmError(
      'ROUTE_ORDER_VALIDATION_ERROR',
      'startId must reference one of the matrix points',
    );
  }
  if (endId !== undefined && !uniquePointIds.has(endId)) {
    throw new RouteOrderAlgorithmError(
      'ROUTE_ORDER_VALIDATION_ERROR',
      'endId must reference one of the matrix points',
    );
  }
  if (startId !== undefined && startId === endId) {
    throw new RouteOrderAlgorithmError(
      'ROUTE_ORDER_VALIDATION_ERROR',
      'startId and endId must be different',
    );
  }

  const sortedPointIds = [...pointIds].sort(compareIds);
  const initialCandidates = sortedPointIds.filter((id) => id !== endId);
  const currentStartId = startId ?? initialCandidates[0];
  if (currentStartId === undefined) {
    throw new RouteOrderAlgorithmError(
      'ROUTE_ORDER_VALIDATION_ERROR',
      'A start point is required when the end point is the only candidate',
    );
  }

  const cells = new Map(
    matrix.cells.map((cell) => [pairKey(cell.originId, cell.destinationId), cell]),
  );
  const orderedPointIds = [currentStartId];
  const visited = new Set([currentStartId]);
  const legs: RouteOrderLeg[] = [];

  while (orderedPointIds.length < pointIds.length) {
    const currentId = orderedPointIds[orderedPointIds.length - 1];
    const remainingIds = pointIds.filter((id) => !visited.has(id));
    const candidateIds =
      endId !== undefined && remainingIds.length > 1
        ? remainingIds.filter((id) => id !== endId)
        : remainingIds;
    const candidates = candidateIds
      .map((destinationId) => {
        const estimate = availableEstimate(cells.get(pairKey(currentId, destinationId)));
        return estimate === undefined ? undefined : { id: destinationId, estimate };
      })
      .filter(
        (candidate): candidate is { id: string; estimate: RouteEstimate } =>
          candidate !== undefined,
      )
      .sort(compareCandidates);
    const next = candidates[0];
    if (next === undefined) {
      throw new RouteOrderAlgorithmError(
        'ROUTE_ORDER_UNAVAILABLE',
        'No available route can reach the remaining points',
      );
    }

    orderedPointIds.push(next.id);
    visited.add(next.id);
    legs.push({
      originId: currentId,
      destinationId: next.id,
      estimate: next.estimate,
    });
  }

  if (endId !== undefined && orderedPointIds[orderedPointIds.length - 1] !== endId) {
    throw new RouteOrderAlgorithmError(
      'ROUTE_ORDER_UNAVAILABLE',
      'The requested end point could not be reached last',
    );
  }

  const result: RouteOrderResult = {
    orderedPointIds,
    legs,
    totalDistanceMeters: legs.reduce(
      (total, leg) =>
        total + (leg.estimate.dataSource === 'unavailable' ? 0 : leg.estimate.distanceMeters),
      0,
    ),
    totalDurationSeconds: legs.reduce(
      (total, leg) =>
        total + (leg.estimate.dataSource === 'unavailable' ? 0 : leg.estimate.durationSeconds),
      0,
    ),
    mode: matrix.mode,
    algorithm: 'nearest_neighbor',
    isOptimal: false,
    generatedAt: matrix.generatedAt,
    warnings: ['Nearest-neighbor ordering is deterministic but not globally optimal.'],
  };

  return RouteOrderResultSchema.parse(result);
};
