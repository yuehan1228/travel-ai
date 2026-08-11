import {
  BUDGET_LEVELS,
  TRAVEL_PACES,
  TRAVEL_PREFERENCES,
  TRANSPORT_PREFERENCES,
  type BudgetLevel,
  type TravelPace,
  type TravelPreference,
  type TransportPreference,
} from '@travel-guide/shared-types';

export const TRAVEL_PREFERENCE_LABELS: Record<TravelPreference, string> = {
  nature: '自然风景',
  history: '人文历史',
  museum: '博物馆',
  city_walk: '城市漫步',
  food: '美食体验',
  trendy: '潮流打卡',
  photography: '摄影采风',
  family: '亲子友好',
  couple: '情侣出游',
  leisure: '休闲度假',
  hiking: '徒步登山',
  hidden_gems: '小众探索',
  nightlife: '夜间生活',
  shopping: '购物逛街',
};

export const TRAVEL_PACE_LABELS: Record<TravelPace, string> = {
  relaxed: '轻松休闲',
  moderate: '张弛有度',
  intensive: '紧凑充实',
};

export const TRANSPORT_PREFERENCE_LABELS: Record<TransportPreference, string> = {
  public_transport: '公共交通',
  taxi: '出租车 / 网约车',
  driving: '自驾',
  walk_and_public_transport: '步行 + 公共交通',
};

export const BUDGET_LEVEL_LABELS: Record<BudgetLevel, string> = {
  economy: '经济实惠',
  comfortable: '舒适适中',
  premium: '品质优先',
};

export interface TripOption<TValue extends string> {
  value: TValue;
  label: string;
}

export const TRAVEL_PREFERENCE_OPTIONS: TripOption<TravelPreference>[] = TRAVEL_PREFERENCES.map(
  (value) => ({ value, label: TRAVEL_PREFERENCE_LABELS[value] }),
);

export const TRAVEL_PACE_OPTIONS: TripOption<TravelPace>[] = TRAVEL_PACES.map((value) => ({
  value,
  label: TRAVEL_PACE_LABELS[value],
}));

export const TRANSPORT_PREFERENCE_OPTIONS: TripOption<TransportPreference>[] =
  TRANSPORT_PREFERENCES.map((value) => ({ value, label: TRANSPORT_PREFERENCE_LABELS[value] }));

export const BUDGET_LEVEL_OPTIONS: TripOption<BudgetLevel>[] = BUDGET_LEVELS.map((value) => ({
  value,
  label: BUDGET_LEVEL_LABELS[value],
}));
