# crypto-spot-paper-bot

บอทสำหรับเรียนรู้ระบบเทรด Spot แบบปลอดภัย: backtest + paper trading + journal รายวันแบบ rule-based  
ค่าเริ่มต้นของโปรเจกต์นี้คือ `EXECUTION_MODE=paper` และ **ไม่ส่งออเดอร์จริง**

## คำเตือนสำคัญ
- โปรเจกต์นี้เพื่อการศึกษาเท่านั้น ไม่ใช่คำแนะนำการลงทุน
- โหมด `paper` ไม่ส่งคำสั่งซื้อขายจริงทุกกรณี
- อย่าใส่ API key จริงลง repo และห้าม commit ไฟล์ `.env`

## ติดตั้ง
```bash
npm install
```

## คำสั่งหลัก
```bash
npm run backtest -- --symbol BTCUSDT --interval 15m --limit 1000 --strategy smaCross
npm run paper -- --symbol BTCUSDT --interval 1m --strategy smaCross --pollMs 5000
npm run journal -- --input paper-log.jsonl --date 2026-02-13
npm test
```

## Paper Trading ให้รันข้ามคืน
จุดเด่นของรอบนี้:
- มี state file (`paper-state.json`) สำหรับ resume หลัง process restart
- มี risk guards ระดับ paper:
  - `--maxNotional`
  - `--maxTradesPerHour`
  - `--cooldownMs`
  - `--dailyMaxLoss` (kill switch)
- มี retry/backoff + timeout + rate limit ที่ data fetch layer

ตัวอย่างคำสั่งสำหรับรันต่อเนื่อง:
```bash
npm run paper -- \
  --symbol BTCUSDT \
  --interval 1m \
  --strategy smaCross \
  --pollMs 5000 \
  --maxNotional 20 \
  --dailyMaxLoss 2 \
  --maxTradesPerHour 20 \
  --cooldownMs 120000
```

ถ้าต้องการเริ่มใหม่โดยไม่ใช้ state เดิม:
```bash
npm run paper -- --resetState --symbol BTCUSDT --interval 1m
```

ดู help:
```bash
npm run paper -- --help
```

## Daily Journal (ฟรี ไม่ใช้ LLM/API)
รองรับ auto-detect input:
- `paper-log.jsonl`
- `reports/latest.json`

ตัวอย่าง:
```bash
npm run journal -- --input paper-log.jsonl --date 2026-02-13
npm run journal -- --input reports/latest.json
```

ถ้าไม่ใส่ `--date` และ input เป็น paper log ระบบจะสรุป "วันนี้" จาก timestamp ใน log

ดู help:
```bash
npm run journal -- --help
```

## โครงสร้างไฟล์ที่ใช้งานบ่อย
- `src/cli/paper.ts` วนลูป paper + guards + resume
- `src/paper/state.ts` โหลด/บันทึก state
- `src/paper/risk.ts` กฎความเสี่ยงระดับ paper
- `src/journal/ruleChecker.ts` วิเคราะห์ผลและตรวจผิดกฎแบบ deterministic
- `src/journal/summarize.ts` CLI สำหรับรายงาน journal

## ทดสอบ
```bash
npm test
```
