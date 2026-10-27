/** 操作者所在租戶的判斷搬到專案共用的 `tenant-scope/`(排班也用);刮刮樂沿用這個路徑。 */
export {
  type OperatorTenant,
  tenantOfOperator,
} from "../tenant-scope/operator-tenant";
