-- 계약당 READY 결제 1건만 허용해 동시 결제 준비를 한 주문으로 모은다.
CREATE UNIQUE INDEX "payments_one_ready_per_contract"
  ON "payments"("contract_id")
  WHERE "status" = 'READY';
