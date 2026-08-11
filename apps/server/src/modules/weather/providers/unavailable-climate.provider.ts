import { Injectable } from '@nestjs/common';

import type {
  WeatherProviderInput,
  WeatherProviderResult,
  ClimateReferenceProvider,
} from './weather.provider';

/**
 * Default production fallback until a licensed historical-climate data source is configured.
 * It deliberately returns no fabricated temperatures, probabilities, or conditions.
 */
@Injectable()
export class UnavailableClimateReferenceProvider implements ClimateReferenceProvider {
  public async getClimateReference(
    input: WeatherProviderInput,
  ): Promise<WeatherProviderResult | undefined> {
    void input;
    return undefined;
  }
}
