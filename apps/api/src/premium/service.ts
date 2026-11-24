import { createHash, timingSafeEqual } from 'node:crypto';
import type { AuthUser, PostgresAuthRepository } from '../auth/repository.js';

export type PremiumSettings = {
  redemptionCode: string;
  campaignId: string;
  campaignName: string;
  campaignEndsAt: string;
  durationDays: number;
};

export class PremiumServiceError extends Error {
  constructor(readonly code: 'premium_not_configured' | 'premium_code_invalid' | 'premium_code_already_redeemed' | 'account_not_found') {
    super(code);
  }
}

export class PremiumService {
  constructor(private readonly repository: Pick<PostgresAuthRepository, 'redeemPremiumCode' | 'hasRedeemedPremiumCampaign'>, private readonly settings: PremiumSettings) {}

  async publicConfig(userId?: string) {
    const end = Date.parse(this.settings.campaignEndsAt);
    const available = Boolean(this.settings.redemptionCode && this.settings.campaignId && Number.isFinite(end) && end > Date.now());
    return {
      available,
      redeemedByAccount: userId ? await this.repository.hasRedeemedPremiumCampaign(userId, this.settings.campaignId) : false,
      campaignName: this.settings.campaignName,
      campaignEndsAt: Number.isFinite(end) ? new Date(end).toISOString() : null,
      durationDays: this.settings.durationDays,
    };
  }

  async redeem(userId: string, presentedCode: string): Promise<AuthUser> {
    if (!(await this.publicConfig()).available) throw new PremiumServiceError('premium_not_configured');
    const normalized = presentedCode.trim().normalize('NFKC').toUpperCase();
    if (!normalized || normalized.length > 128 || !this.matchesCode(normalized)) throw new PremiumServiceError('premium_code_invalid');
    const result = await this.repository.redeemPremiumCode(userId, this.settings.campaignId, this.settings.durationDays);
    if (result.kind === 'account_not_found' || result.kind === 'already_redeemed')
      throw new PremiumServiceError(result.kind === 'account_not_found' ? 'account_not_found' : 'premium_code_already_redeemed');
    return result.user;
  }

  private matchesCode(presented: string) {
    const expected = this.settings.redemptionCode.trim().normalize('NFKC').toUpperCase();
    const presentedHash = createHash('sha256').update(presented).digest();
    const expectedHash = createHash('sha256').update(expected).digest();
    return timingSafeEqual(presentedHash, expectedHash);
  }
}
