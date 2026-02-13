# crypto-spot-paper-bot

โปรเจกต์สำหรับมือใหม่เพื่อเรียนรู้ระบบเทรดคริปโต Spot แบบปลอดภัย: **Backtest + Paper Trading + Binance Spot Testnet (แบบป้องกันหลายชั้น)**

> ค่าเริ่มต้นปลอดภัยเสมอ: `EXECUTION_MODE=paper` และคำสั่งเทรดบน testnet จะส่งแบบ validate-only (`/api/v3/order/test`) เป็นดีฟอลต์

## สิ่งที่ทำได้
- ดึงข้อมูลตลาดฟรีจาก Binance public endpoint
- Backtest กัน lookahead bias (เข้าแท่งถัดไป)
- คิด fee/slippage ได้
- กลยุทธ์ baseline: SMA Cross และ RSI Mean Reversion
- Paper loop พร้อม kill switch
- Testnet REST + WS API (userDataStream.subscribe.signature)
- Safety Switch 4 ชั้นก่อนส่ง `POST /api/v3/order` จริงบน testnet

## คำเตือนความปลอดภัย
- โปรเจกต์นี้เพื่อการเรียนรู้ ไม่ใช่คำแนะนำการลงทุน
- ห้าม commit `.env`
- ห้ามแชร์ `BINANCE_TESTNET_API_SECRET`
- ดีฟอลต์ไม่ส่งออเดอร์จริง

## ติดตั้ง
```bash
npm install
```

## ใช้งานหลักเดิม
```bash
npm test
npm run backtest -- --symbol BTCUSDT --interval 15m --limit 1000 --strategy smaCross --feeBps 10 --slippageBps 5
npm run paper -- --symbol BTCUSDT --interval 15m --strategy rsiMeanReversion --maxTicks 10
npm run journal -- --mode backtest --file reports/latest.json
```

## ตั้งค่า Binance Spot Testnet
1. เข้า Spot Test Network และล็อกอินด้วย GitHub
2. สร้าง API Key/Secret สำหรับ Spot Testnet
3. คัดลอก `.env.example` เป็น `.env` แล้วกรอกค่า key/secret

ตัวแปรสำคัญ:
- `EXECUTION_MODE=paper|testnet` (default `paper`)
- `BINANCE_TESTNET_TRADING_ENABLED=NO|YES` (default `NO`)
- `BINANCE_TESTNET_MAX_NOTIONAL` และ `BINANCE_TESTNET_MAX_ORDERS_PER_MIN`

## ลองทีละขั้น (แนะนำ)
```bash
npm run testnet:ping
npm run testnet:time
npm run testnet:account
npm run testnet:order:test -- --symbol BTCUSDT --side BUY --type MARKET --quoteOrderQty 10
npm run testnet:ws:userdata -- --durationMs 30000
```

## Live order บน testnet (ต้องผ่าน Safety Switch 4 ชั้น)
ชั้น A: default `EXECUTION_MODE=paper`
ชั้น B: ต้องตั้ง `EXECUTION_MODE=testnet`
ชั้น C: ต้องตั้ง `BINANCE_TESTNET_TRADING_ENABLED=YES`
ชั้น D: ต้องส่ง flag `--i-know-what-im-doing=YES`

ตัวอย่าง:
```bash
npm run testnet:order:live -- --symbol BTCUSDT --side BUY --type MARKET --quoteOrderQty 10 --i-know-what-im-doing=YES
```

ถ้าขาดสวิตช์ข้อใดข้อหนึ่ง ระบบจะ reject ทันที

## โครงสร้าง (สรุป)
- `src/exchange`: market/testnet/paper execution + ws api
- `src/core`: routing + risk guards + time sync + safety switch
- `src/strategy`: signal engine
- `src/backtest`: simulation engine
- `src/cli`: command entrypoints
- `src/journal`: summary/rule checks
