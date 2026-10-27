import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { registerHandoverAmount } from "../store/previous-shift";
import { CheckoutService } from "./checkout.service";

/**
 * 交班結帳向店面登記的事(規格 6.6 期初零用金):「這一班留給下一班多少」= 最近一張結帳單的 `leftForNext`
 * (送出就算,核准前下一班先開班也先用它;退回修改後跟著更新)。沒有結帳單 = 0。
 */
@Injectable()
export class CheckoutRegistrations implements OnModuleInit, OnModuleDestroy {
  private unregister: (() => void) | null = null;

  constructor(private readonly checkout: CheckoutService) {}

  onModuleInit(): void {
    this.unregister = registerHandoverAmount((tenantId, shiftId) =>
      this.checkout.handoverAmountOf(tenantId, shiftId),
    );
  }

  onModuleDestroy(): void {
    this.unregister?.();
    this.unregister = null;
  }
}
