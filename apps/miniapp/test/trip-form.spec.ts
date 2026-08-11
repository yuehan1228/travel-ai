import { CreateTripInputSchema } from '@travel-guide/shared-schemas';
import { describe, expect, it } from 'vitest';

import {
  canSubmitTripForm,
  createDefaultTripFormState,
  mapTripValidationErrors,
  parseCustomBudgetText,
  toCreateTripInput,
  validateTripForm,
  type TripFormState,
} from '../utils/trip-form';

const createValidForm = (): TripFormState => ({
  ...createDefaultTripFormState(),
  cityName: '  上海  ',
  cityCode: ' SHA ',
  origin: ' 北京 ',
  startDate: '2026-03-01',
  endDate: '2026-03-03',
  travelerCount: 2,
  preferences: ['food', 'city_walk'],
  pace: 'moderate',
  budgetMode: 'level',
  budgetLevel: 'comfortable',
  transportPreference: 'public_transport',
  extraRequirements: '  想吃本地美食。  ',
});

describe('trip form model', () => {
  it('converts the default-shaped form to a schema-valid input after fields are filled', () => {
    const input = toCreateTripInput(createValidForm());

    expect(input).toEqual({
      destination: { cityName: '上海', cityCode: 'SHA' },
      origin: '北京',
      startDate: '2026-03-01',
      endDate: '2026-03-03',
      travelerCount: 2,
      preferences: ['food', 'city_walk'],
      pace: 'moderate',
      budget: { type: 'level', level: 'comfortable', currency: 'CNY' },
      transportPreference: 'public_transport',
      extraRequirements: '想吃本地美食。',
    });
    expect(CreateTripInputSchema.safeParse(input).success).toBe(true);
  });

  it.each(['economy', 'comfortable', 'premium'] as const)('accepts level budget %s', (level) => {
    const input = toCreateTripInput({ ...createValidForm(), budgetLevel: level });
    expect(input.budget).toEqual({ type: 'level', level, currency: 'CNY' });
  });

  it('accepts a trimmed custom budget with two decimal places', () => {
    const form = {
      ...createValidForm(),
      budgetMode: 'custom' as const,
      customBudgetText: ' 1234.56 ',
    };

    expect(parseCustomBudgetText(form.customBudgetText)).toBe(1234.56);
    expect(toCreateTripInput(form).budget).toEqual({
      type: 'custom',
      totalCny: 1234.56,
      currency: 'CNY',
    });
  });

  it('trims optional and required text fields', () => {
    const input = toCreateTripInput(createValidForm());
    expect(input.destination.cityName).toBe('上海');
    expect(input.origin).toBe('北京');
    expect(input.extraRequirements).toBe('想吃本地美食。');
  });

  it('omits the optional budget when no budget mode is selected', () => {
    const input = toCreateTripInput({
      ...createValidForm(),
      budgetMode: 'none',
      budgetLevel: '',
      customBudgetText: '',
    });

    expect(input).not.toHaveProperty('budget');
  });

  it('maps an empty city to a stable Chinese message', () => {
    const result = validateTripForm({ ...createValidForm(), cityName: '   ' });
    expect(result.valid).toBe(false);
    expect(result.errors.cityName).toBe('请输入目的地城市');
  });

  it('maps invalid and reversed dates', () => {
    const invalidDate = validateTripForm({ ...createValidForm(), startDate: '2026-02-30' });
    expect(invalidDate.errors.startDate).toBe('请选择有效日期');

    const reversed = validateTripForm({
      ...createValidForm(),
      startDate: '2026-03-03',
      endDate: '2026-03-01',
    });
    expect(reversed.errors.endDate).toBe('返程日期不能早于出发日期');
  });

  it('maps a trip longer than fourteen days', () => {
    const result = validateTripForm({
      ...createValidForm(),
      startDate: '2026-03-01',
      endDate: '2026-03-15',
    });
    expect(result.errors.endDate).toBe('行程不能超过 14 天');
  });

  it.each([0, 21, 1.5])('rejects traveler count %s', (travelerCount) => {
    const result = validateTripForm({ ...createValidForm(), travelerCount });
    expect(result.errors.travelerCount).toBe('出行人数需为 1～20 人');
  });

  it('maps empty and duplicate preferences', () => {
    const empty = validateTripForm({ ...createValidForm(), preferences: [] });
    expect(empty.errors.preferences).toBe('请至少选择一项旅行偏好');

    const duplicate = validateTripForm({ ...createValidForm(), preferences: ['food', 'food'] });
    expect(duplicate.errors.preferences).toBe('旅行偏好不能重复');
  });

  it.each(['NaN', 'Infinity', '123.456', '-1', ''])('rejects custom budget %j', (value) => {
    const result = validateTripForm({
      ...createValidForm(),
      budgetMode: 'custom',
      customBudgetText: value,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.customBudgetText).toBe('请输入有效的自定义预算（大于 0，最多两位小数）');
  });

  it('maps an unselected budget level to the budget field', () => {
    const result = validateTripForm({
      ...createValidForm(),
      budgetMode: 'level',
      budgetLevel: '',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.budget).toBe('请选择预算等级');
    expect(result.errors.customBudgetText).toBeUndefined();
  });

  it('maps overlong extra requirements', () => {
    const result = validateTripForm({ ...createValidForm(), extraRequirements: 'x'.repeat(1001) });
    expect(result.errors.extraRequirements).toBe('补充要求不能超过 1000 字');
  });

  it('maps Zod issues without exposing the original English message', () => {
    const parsed = CreateTripInputSchema.safeParse({
      ...toCreateTripInput(createValidForm()),
      endDate: '2026-03-01',
      startDate: '2026-03-03',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(mapTripValidationErrors(parsed.error).endDate).toBe('返程日期不能早于出发日期');
    }
  });

  it('does not allow duplicate submissions while submitting', () => {
    expect(canSubmitTripForm(false)).toBe(true);
    expect(canSubmitTripForm(true)).toBe(false);
  });
});
