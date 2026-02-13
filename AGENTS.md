# Architecture Spec (crypto-spot-paper-bot)

## Data Flow
1. `exchange/binancePublic.ts`
   - ดึง OHLCV/ราคา จาก Binance public API
   - cache ไฟล์ JSON ใน `data-cache/`
2. `strategy/*`
   - รับ candles และ index
   - คืนสัญญาณ BUY/SELL/HOLD พร้อมเหตุผล
3. `backtest/engine.ts`
   - รับสัญญาณและ candles
   - fill ที่แท่งถัดไปเพื่อลด lookahead bias
   - ใส่ fee/slippage ทุกดีล
4. `cli/backtest.ts`
   - รัน backtest และบันทึก `reports/latest.json`
5. `cli/paper.ts`
   - polling market data + strategy
   - จัดการพอร์ตจำลองและบันทึก `paper-log.jsonl`
6. `exchange/binanceTestnetRest.ts` + `core/executionRouter.ts`
   - เลือก execution backend (`paper|testnet`)
   - โหมดปกติเทรดแบบ validate-only (`/api/v3/order/test`)
7. `exchange/binanceWsApi.ts` + `exchange/binanceUserData.ts`
   - เชื่อม ws-api testnet
   - subscribe user data stream แบบ signed ต่อ request
8. `journal/summarize.ts`
   - สรุปผลภาษาไทย + rule checker

## Layering Rules
- ห้าม strategy เรียก exchange โดยตรง
- backtest ต้องไม่ fetch data เอง
- CLI เป็นตัว orchestrate ทุกโมดูล
- Safety switch ต้องผ่าน 4 ชั้นก่อนส่ง `/api/v3/order` จริง

## Safety
- ดีฟอลต์ไม่ส่งคำสั่งซื้อขายจริง (`EXECUTION_MODE=paper`)
- ไม่มีการเก็บ API key จริง
- มี kill switch สำหรับ paper mode
- มี risk guards: max notional + max orders/min

## TODO ถัดไป
- เพิ่ม walk-forward validation
- เพิ่ม position sizing แบบ ATR
- เพิ่ม metric Sharpe/Sortino
- เพิ่ม exporter เป็น markdown/html report
