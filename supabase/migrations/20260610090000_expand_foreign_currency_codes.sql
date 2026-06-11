-- Migration: expand_foreign_currency_codes
-- Expand public.foreign_currency_code from {INR, USD, EUR, CHF} to all active
-- ISO 4217 codes. MUST stay in sync with ISO_CURRENCY_CODES in
-- src/core/constants/iso-currency-codes.ts.
-- ALTER TYPE ... ADD VALUE is allowed in a transaction on PG >= 12 as long as
-- the new values are not used in the same transaction.

DO $$
DECLARE
  code text;
BEGIN
  FOREACH code IN ARRAY ARRAY[
    'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN',
    'BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BRL',
    'BSD','BTN','BWP','BYN','BZD','CAD','CDF','CLP','CNY','COP',
    'CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN',
    'ETB','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ',
    'GYD','HKD','HNL','HTG','HUF','IDR','ILS','IQD','IRR','ISK',
    'JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD',
    'KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL',
    'MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN',
    'MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','OMR','PAB',
    'PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB',
    'RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SOS',
    'SRD','SSP','STN','SVC','SYP','SZL','THB','TJS','TMT','TND',
    'TOP','TRY','TTD','TWD','TZS','UAH','UGX','UYU','UZS','VES',
    'VND','VUV','WST','XAF','XCD','XOF','XPF','YER','ZAR','ZMW',
    'ZWG'
  ]
  LOOP
    EXECUTE format(
      'ALTER TYPE public.foreign_currency_code ADD VALUE IF NOT EXISTS %L',
      code
    );
  END LOOP;
END
$$;
