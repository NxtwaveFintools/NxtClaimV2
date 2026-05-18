-- Trigger function: recomputes total_amount from component amounts on every write.
-- Applies to expense_details only. advance_details is intentionally excluded
-- because its total_amount is user-provided with no component breakdown.
CREATE OR REPLACE FUNCTION public.set_expense_total_amount()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.total_amount := ROUND(
    COALESCE(NEW.basic_amount, 0)
    + COALESCE(NEW.cgst_amount, 0)
    + COALESCE(NEW.sgst_amount, 0)
    + COALESCE(NEW.igst_amount, 0),
    2
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_expense_total_amount
BEFORE INSERT OR UPDATE ON public.expense_details
FOR EACH ROW EXECUTE FUNCTION public.set_expense_total_amount();
