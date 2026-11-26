import {
  Field,
  Float,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

/**
 * 營運報表區塊 2b 批售(專案規格 21.7;正本 `docs/modules/project/reports.md`「營運報表」)。張數、本數、金額、
 * 原成本是「批售」事件 − 「取消批售」事件(作廢在作廢那一期是負數);待標註的跳號照共用的待標註扣除。
 * 沒有 `reports.show-cost` 時原成本回 null(獲利、獲利率由畫面算,跟著不顯示)。
 */

/** 依批售客戶的一列(單數、本數、張數有正負:作廢那一期扣回)。 */
@ObjectType("LotteryOperationsWholesaleCustomer")
export class LotteryOperationsWholesaleCustomerModel {
  /** 批售客戶 id(單上沒有 = null) */
  @Field(() => ID, { nullable: true })
  customerId!: string | null;

  /** 店名(讀不到客戶時用單上存的文字) */
  @Field(() => String)
  customerName!: string;

  @Field(() => Int)
  documents!: number;

  @Field(() => Int)
  books!: number;

  @Field(() => Int)
  tickets!: number;

  /** 批售金額(加總後四捨五入到元) */
  @Field(() => Float)
  amount!: number;

  /** 原成本(出貨 / 取消當下的單張成本快照;加總後四捨五入到元) */
  @Field(() => Float, { nullable: true })
  cost!: number | null;
}

/** 逐單的一列:出貨在這一期 = 正數;作廢在這一期 = 負數一列(`voided`)。 */
@ObjectType("LotteryOperationsWholesaleDocument")
export class LotteryOperationsWholesaleDocumentModel {
  @Field(() => ID)
  submissionId!: string;

  @Field(() => String, { nullable: true })
  serialNo!: string | null;

  /** 這一列是作廢扣回的那一列 */
  @Field(() => Boolean)
  voided!: boolean;

  /** 出貨時間(「批售」事件的時間;作廢列 = 取消批售的時間) */
  @Field(() => GraphQLISODateTime)
  at!: Date;

  @Field(() => ID, { nullable: true })
  customerId!: string | null;

  @Field(() => String)
  customerName!: string;

  @Field(() => Int)
  books!: number;

  @Field(() => Int)
  tickets!: number;

  @Field(() => Float)
  amount!: number;

  @Field(() => Float, { nullable: true })
  cost!: number | null;

  /** `auto_bank` 從帳戶入帳 / `collect_first` 收到錢再核准;看不懂 = null */
  @Field(() => String, { nullable: true })
  paymentMode!: string | null;

  /** 期末已收淨額(只算期末以前的收付) */
  @Field(() => Float)
  receivedAtEnd!: number;

  /** 期末待收(期末已收少於批售金額的差;沒有 = 0) */
  @Field(() => Float)
  toReceiveAtEnd!: number;
}

/** 一組單據的合計 + 單號(最多 5 張):期末已收未出貨、期末批售中。 */
@ObjectType("LotteryOperationsWholesaleDocuments")
export class LotteryOperationsWholesaleDocumentsModel {
  @Field(() => Int)
  count!: number;

  @Field(() => Int)
  books!: number;

  @Field(() => Int)
  tickets!: number;

  @Field(() => Float)
  amount!: number;

  @Field(() => [String])
  serialNos!: string[];
}

/** 區塊 2b 批售,加上區塊 4 另外列的「期末批售中」。 */
@ObjectType("LotteryOperationsWholesale")
export class LotteryOperationsWholesaleModel {
  @Field(() => [LotteryOperationsWholesaleCustomerModel])
  customers!: LotteryOperationsWholesaleCustomerModel[];

  @Field(() => [LotteryOperationsWholesaleDocumentModel])
  documents!: LotteryOperationsWholesaleDocumentModel[];

  /** 期末那一刻還沒出貨、期末以前已收淨額不是 0 的單(金額 = 已收淨額合計;本數、張數 0) */
  @Field(() => LotteryOperationsWholesaleDocumentsModel)
  receivedUnshipped!: LotteryOperationsWholesaleDocumentsModel;

  /** 區塊 4 另外列的:期末那一刻被審核中批售單鎖住的本(仍算在期末庫存,不進核對) */
  @Field(() => LotteryOperationsWholesaleDocumentsModel)
  pendingAtEnd!: LotteryOperationsWholesaleDocumentsModel;
}
