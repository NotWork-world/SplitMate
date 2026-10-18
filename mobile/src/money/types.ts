// Engine input/output types. Field names match the server JSON exactly (snake_case).

export type SplitMode = 'equal' | 'shares' | 'percent' | 'exact';
export type TaxScheme = 'gst' | 'cgst_sgst' | 'igst';
export type Kind = 'fixed' | 'percent';

export interface ConsumerIn {
  member_id: string;
  value?: number;
}

export interface ItemIn {
  id: string;
  name: string;
  quantity_milli?: number;
  unit_price_minor: number;
  discount?: {kind: Kind; value: number} | null;
  tax_rate_bp?: number;
  tax_inclusive?: boolean;
  tax_scheme?: TaxScheme;
  split_mode?: SplitMode;
  consumers?: ConsumerIn[];
}

export interface DiscountIn {
  id: string;
  label?: string;
  kind: Kind;
  value: number;
  stage?: 'pre_tax' | 'post_tax';
  allocation?: 'proportional' | 'equal';
  item_ids?: string[] | null;
  is_coupon?: boolean;
}

export type ChargeType = 'service' | 'packaging' | 'delivery' | 'tip' | 'other' | 'adjustment';

export interface ChargeIn {
  id: string;
  label?: string;
  type: ChargeType;
  kind?: Kind;
  value: number;
  tax_rate_bp?: number;
  tax_scheme?: TaxScheme;
  allocation?: 'proportional' | 'equal';
}

export interface ReportedTaxIn {
  component: 'GST' | 'CGST' | 'SGST' | 'IGST';
  rate_bp: number;
  amount_minor: number;
}

export interface BillInput {
  currency: string;
  items: ItemIn[];
  discounts?: DiscountIn[];
  charges?: ChargeIn[];
  reported_taxes?: ReportedTaxIn[];
  rounding?: {mode: 'none' | 'explicit' | 'nearest_unit'; amount_minor?: number};
  receipt_total_minor?: number | null;
}

export interface Issue {
  code: string;
  message: string;
  blocking: boolean;
  ref: string | null;
}

export interface ItemShare {
  member_id: string;
  gross: number;
  item_discount: number;
  bill_discount: number;
  tax: number;
  total: number;
}

export interface ItemResult {
  id: string;
  name: string;
  gross: number;
  item_discount: number;
  net: number;
  bill_discount: number;
  amount_after_discounts: number;
  taxable_base: number;
  tax: number;
  tax_inclusive: boolean;
  tax_rate_bp: number;
  tax_scheme: string;
  total: number;
  assigned: boolean;
  shares: ItemShare[];
}

export interface DiscountResult {
  id: string;
  label: string;
  stage: string;
  kind: string;
  value: number;
  is_coupon: boolean;
  amount: number;
  allocation: string;
  allocations: Record<string, number>;
}

export interface ChargeResult {
  id: string;
  label: string;
  type: string;
  kind: string;
  value: number;
  amount: number;
  tax: number;
  total: number;
  allocation: string;
  allocations: Record<string, number>;
}

export interface TaxLine {
  component: string;
  component_rate_bp: number;
  group_rate_bp: number;
  scheme: string;
  inclusive: boolean;
  taxable_base: number;
  amount: number;
  computed_amount: number;
  source: 'configured' | 'receipt';
}

export interface PersonResult {
  member_id: string;
  gross: number;
  item_discounts: number;
  bill_discounts: number;
  tax_added: number;
  tax_included: number;
  charges: number;
  post_tax_discounts: number;
  rounding: number;
  total: number;
  items: Array<{item_id: string; name: string; amount: number}>;
}

export interface BillResult {
  engine_version: number;
  currency: string;
  item_gross: number;
  item_discounts: number;
  items_net: number;
  pre_tax_discounts: number;
  taxable_base: number;
  tax_added: number;
  tax_included: number;
  tax_total: number;
  charges: number;
  charges_tax: number;
  post_tax_discounts: number;
  rounding: number;
  total: number;
  receipt_total: number | null;
  receipt_difference: number | null;
  allocated_total: number;
  unallocated: number;
  items: ItemResult[];
  discounts: DiscountResult[];
  charge_lines: ChargeResult[];
  tax_lines: TaxLine[];
  people: PersonResult[];
  issues: Issue[];
  can_finalize: boolean;
}
