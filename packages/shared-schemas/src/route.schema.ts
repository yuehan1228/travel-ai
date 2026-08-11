import { z } from 'zod';

import {
  ROUTE_DATA_SOURCES,
  ROUTE_MODES,
  type AvailableRouteEstimate,
  type EstimateRouteMatrixInput,
  type EstimateRouteOrderInput,
  type EstimateRouteInput,
  type RouteDataSource,
  type RouteEndpoint,
  type RouteEstimate,
  type RouteMatrixCell,
  type RouteMatrixPoint,
  type RouteMatrixResult,
  type RouteOrderLeg,
  type RouteOrderResult,
  type RouteMode,
  type UnavailableRouteEstimate,
} from '@travel-guide/shared-types';

import {
  createOptionalTrimmedStringSchema,
  createTrimmedRequiredStringSchema,
} from './common.schema';
import { GeoPointSchema } from './place.schema';

export const RouteModeSchema: z.ZodType<RouteMode, z.ZodTypeDef, unknown> = z.enum(ROUTE_MODES);

export const RouteDataSourceSchema: z.ZodType<RouteDataSource, z.ZodTypeDef, unknown> =
  z.enum(ROUTE_DATA_SOURCES);

export const RouteEndpointSchema: z.ZodType<RouteEndpoint, z.ZodTypeDef, unknown> = z
  .object({
    location: GeoPointSchema,
    placeId: createOptionalTrimmedStringSchema('placeId', 128),
  })
  .strict();

export const EstimateRouteInputSchema: z.ZodType<EstimateRouteInput, z.ZodTypeDef, unknown> = z
  .object({
    origin: RouteEndpointSchema,
    destination: RouteEndpointSchema,
    mode: RouteModeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.origin.location.longitude === value.destination.location.longitude &&
      value.origin.location.latitude === value.destination.location.latitude
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination', 'location'],
        message: 'origin and destination must be different',
      });
    }
  });

const ROUTE_MATRIX_MIN_POINTS = 2;
const ROUTE_MATRIX_MAX_POINTS = 10;
const ROUTE_MATRIX_POINT_ID_MAX_LENGTH = 64;

const routeMatrixPointIdSchema = createTrimmedRequiredStringSchema(
  'id',
  ROUTE_MATRIX_POINT_ID_MAX_LENGTH,
);

export const RouteMatrixPointSchema: z.ZodType<RouteMatrixPoint, z.ZodTypeDef, unknown> = z
  .object({
    id: routeMatrixPointIdSchema,
    endpoint: RouteEndpointSchema,
  })
  .strict();

const normalizedCoordinateKey = (point: RouteMatrixPoint): string =>
  `${point.endpoint.location.longitude.toFixed(6)},${point.endpoint.location.latitude.toFixed(6)}`;

const validateMatrixPoints = (
  points: RouteMatrixPoint[],
  context: z.RefinementCtx,
  path: (string | number)[],
): void => {
  const ids = new Map<string, number>();
  const coordinates = new Map<string, number>();
  points.forEach((point, index) => {
    const previousId = ids.get(point.id);
    if (previousId !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, 'id'],
        message: 'point ids must be unique',
      });
    } else {
      ids.set(point.id, index);
    }

    const coordinateKey = normalizedCoordinateKey(point);
    const previousCoordinate = coordinates.get(coordinateKey);
    if (previousCoordinate !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, 'endpoint', 'location'],
        message: 'point coordinates must be unique after normalization',
      });
    } else {
      coordinates.set(coordinateKey, index);
    }
  });
};

export const EstimateRouteMatrixInputSchema: z.ZodType<
  EstimateRouteMatrixInput,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    points: z
      .array(RouteMatrixPointSchema)
      .min(ROUTE_MATRIX_MIN_POINTS, {
        message: `at least ${ROUTE_MATRIX_MIN_POINTS} points are required`,
      })
      .max(ROUTE_MATRIX_MAX_POINTS, {
        message: `at most ${ROUTE_MATRIX_MAX_POINTS} points are allowed`,
      }),
    mode: RouteModeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    validateMatrixPoints(value.points, context, ['points']);
  });

export const EstimateRouteOrderInputSchema: z.ZodType<
  EstimateRouteOrderInput,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    points: z
      .array(RouteMatrixPointSchema)
      .min(ROUTE_MATRIX_MIN_POINTS, {
        message: `at least ${ROUTE_MATRIX_MIN_POINTS} points are required`,
      })
      .max(ROUTE_MATRIX_MAX_POINTS, {
        message: `at most ${ROUTE_MATRIX_MAX_POINTS} points are allowed`,
      }),
    mode: RouteModeSchema,
    startId: routeMatrixPointIdSchema.optional(),
    endId: routeMatrixPointIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    validateMatrixPoints(value.points, context, ['points']);
    const pointIds = new Set(value.points.map((point) => point.id));

    if (value.startId !== undefined && !pointIds.has(value.startId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startId'],
        message: 'startId must reference one of the input points',
      });
    }
    if (value.endId !== undefined && !pointIds.has(value.endId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endId'],
        message: 'endId must reference one of the input points',
      });
    }
    if (value.startId !== undefined && value.startId === value.endId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endId'],
        message: 'startId and endId must be different',
      });
    }
  });

const nonNegativeIntegerSchema = z.number().finite().int().nonnegative();

const tollsSchema = z
  .number()
  .finite()
  .nonnegative()
  .refine((value) => Math.round(value * 100) / 100 === value, {
    message: 'tollsCny must have at most two decimal places',
  });

const routeEstimateBaseSchema = z.object({
  origin: RouteEndpointSchema,
  destination: RouteEndpointSchema,
  mode: RouteModeSchema,
  provider: createTrimmedRequiredStringSchema('provider', 64),
  fetchedAt: z.string().datetime({ offset: true }),
});

const availableRouteEstimateSchema: z.ZodType<AvailableRouteEstimate, z.ZodTypeDef, unknown> =
  routeEstimateBaseSchema
    .extend({
      dataSource: z.enum(['map_provider', 'cache']),
      distanceMeters: nonNegativeIntegerSchema,
      durationSeconds: nonNegativeIntegerSchema,
      tollsCny: tollsSchema.optional(),
    })
    .strict();

const unavailableRouteEstimateSchema: z.ZodType<UnavailableRouteEstimate, z.ZodTypeDef, unknown> =
  routeEstimateBaseSchema
    .extend({
      dataSource: z.literal('unavailable'),
    })
    .strict();

export const RouteEstimateSchema: z.ZodType<RouteEstimate, z.ZodTypeDef, unknown> = z
  .union([availableRouteEstimateSchema, unavailableRouteEstimateSchema])
  .superRefine((value, context) => {
    if (
      value.origin.location.longitude === value.destination.location.longitude &&
      value.origin.location.latitude === value.destination.location.latitude
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination', 'location'],
        message: 'origin and destination must be different',
      });
    }
  });

const routeMatrixCellIdSchema = routeMatrixPointIdSchema;

const availableRouteMatrixCellSchema = z
  .object({
    originId: routeMatrixCellIdSchema,
    destinationId: routeMatrixCellIdSchema,
    estimate: RouteEstimateSchema,
    status: z.literal('available'),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.estimate.dataSource === 'unavailable') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimate', 'dataSource'],
        message: 'available cells require an available route estimate',
      });
    }
  });

const unavailableRouteMatrixCellSchema = z
  .object({
    originId: routeMatrixCellIdSchema,
    destinationId: routeMatrixCellIdSchema,
    status: z.literal('unavailable'),
  })
  .strict();

export const RouteMatrixCellSchema: z.ZodType<RouteMatrixCell, z.ZodTypeDef, unknown> = z.union([
  availableRouteMatrixCellSchema,
  unavailableRouteMatrixCellSchema,
]);

const sameNormalizedLocation = (left: RouteEndpoint, right: RouteEndpoint): boolean =>
  left.location.longitude.toFixed(6) === right.location.longitude.toFixed(6) &&
  left.location.latitude.toFixed(6) === right.location.latitude.toFixed(6);

export const RouteMatrixResultSchema: z.ZodType<RouteMatrixResult, z.ZodTypeDef, unknown> = z
  .object({
    points: z
      .array(RouteMatrixPointSchema)
      .min(ROUTE_MATRIX_MIN_POINTS, {
        message: `at least ${ROUTE_MATRIX_MIN_POINTS} points are required`,
      })
      .max(ROUTE_MATRIX_MAX_POINTS, {
        message: `at most ${ROUTE_MATRIX_MAX_POINTS} points are allowed`,
      }),
    mode: RouteModeSchema,
    cells: z.array(RouteMatrixCellSchema),
    generatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    validateMatrixPoints(value.points, context, ['points']);

    const pointById = new Map(value.points.map((point) => [point.id, point]));
    const expectedPairs = new Set<string>();
    for (const origin of value.points) {
      for (const destination of value.points) {
        if (origin.id !== destination.id) {
          expectedPairs.add(`${origin.id}\u0000${destination.id}`);
        }
      }
    }

    if (value.cells.length !== expectedPairs.size) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cells'],
        message: 'cells must contain exactly n × (n - 1) directed routes',
      });
    }

    const seenPairs = new Set<string>();
    value.cells.forEach((cell, index) => {
      const pair = `${cell.originId}\u0000${cell.destinationId}`;
      const origin = pointById.get(cell.originId);
      const destination = pointById.get(cell.destinationId);
      if (origin === undefined || destination === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cells', index],
          message: 'cell references an unknown point id',
        });
      }
      if (cell.originId === cell.destinationId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cells', index],
          message: 'cells must not contain routes from a point to itself',
        });
      }
      if (seenPairs.has(pair)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cells', index],
          message: 'directed cell pairs must be unique',
        });
      } else {
        seenPairs.add(pair);
      }
      if (!expectedPairs.has(pair)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cells', index],
          message: 'cell must be a directed non-diagonal point pair',
        });
      }

      if (
        cell.status === 'available' &&
        cell.estimate !== undefined &&
        origin !== undefined &&
        destination !== undefined
      ) {
        if (cell.estimate.mode !== value.mode) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['cells', index, 'estimate', 'mode'],
            message: 'cell estimate mode must match the matrix mode',
          });
        }
        if (
          !sameNormalizedLocation(cell.estimate.origin, origin.endpoint) ||
          !sameNormalizedLocation(cell.estimate.destination, destination.endpoint)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['cells', index, 'estimate'],
            message: 'cell estimate endpoints must match the referenced points',
          });
        }
      }
    });

    for (const pair of expectedPairs) {
      if (!seenPairs.has(pair)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cells'],
          message: 'cells must include every directed non-diagonal point pair',
        });
        break;
      }
    }
  });

const routeOrderLegSchema: z.ZodType<RouteOrderLeg, z.ZodTypeDef, unknown> = z
  .object({
    originId: routeMatrixPointIdSchema,
    destinationId: routeMatrixPointIdSchema,
    estimate: RouteEstimateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.originId === value.destinationId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destinationId'],
        message: 'route order legs must not contain self-routes',
      });
    }
    if (value.estimate.dataSource === 'unavailable') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimate'],
        message: 'route order legs require an available route estimate',
      });
    }
  });

const routeOrderWarningSchema = z.string().trim().min(1).max(256);

export const RouteOrderLegSchema = routeOrderLegSchema;

export const RouteOrderResultSchema: z.ZodType<RouteOrderResult, z.ZodTypeDef, unknown> = z
  .object({
    orderedPointIds: z
      .array(routeMatrixPointIdSchema)
      .min(ROUTE_MATRIX_MIN_POINTS)
      .max(ROUTE_MATRIX_MAX_POINTS),
    legs: z.array(routeOrderLegSchema).max(ROUTE_MATRIX_MAX_POINTS - 1),
    totalDistanceMeters: nonNegativeIntegerSchema,
    totalDurationSeconds: nonNegativeIntegerSchema,
    mode: RouteModeSchema,
    algorithm: z.literal('nearest_neighbor'),
    isOptimal: z.literal(false),
    generatedAt: z.string().datetime({ offset: true }),
    warnings: z.array(routeOrderWarningSchema).max(32),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.orderedPointIds).size !== value.orderedPointIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['orderedPointIds'],
        message: 'orderedPointIds must not contain duplicates',
      });
    }
    if (value.legs.length !== value.orderedPointIds.length - 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['legs'],
        message: 'legs must match adjacent orderedPointIds',
      });
    }

    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;
    value.legs.forEach((leg, index) => {
      if (
        leg.originId !== value.orderedPointIds[index] ||
        leg.destinationId !== value.orderedPointIds[index + 1]
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['legs', index],
          message: 'legs must follow adjacent orderedPointIds',
        });
      }
      if (leg.estimate.mode !== value.mode) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['legs', index, 'estimate', 'mode'],
          message: 'leg estimate mode must match the order mode',
        });
      }
      if (leg.estimate.dataSource !== 'unavailable') {
        totalDistanceMeters += leg.estimate.distanceMeters;
        totalDurationSeconds += leg.estimate.durationSeconds;
      }
    });

    if (value.totalDistanceMeters !== totalDistanceMeters) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalDistanceMeters'],
        message: 'totalDistanceMeters must equal the leg distance sum',
      });
    }
    if (value.totalDurationSeconds !== totalDurationSeconds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalDurationSeconds'],
        message: 'totalDurationSeconds must equal the leg duration sum',
      });
    }
  });

export { GeoPointSchema };

export { ROUTE_MATRIX_MAX_POINTS, ROUTE_MATRIX_MIN_POINTS, ROUTE_MATRIX_POINT_ID_MAX_LENGTH };
