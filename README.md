# crypto-spot-paper-bot

à¹‚à¸›à¸£à¹€à¸ˆà¸à¸•à¹Œà¸ªà¸³à¸«à¸£à¸±à¸šà¹€à¸£à¸µà¸¢à¸™à¸£à¸¹à¹‰à¸£à¸°à¸šà¸šà¹€à¸—à¸£à¸”à¸„à¸£à¸´à¸›à¹‚à¸• Spot à¹à¸šà¸šà¸›à¸¥à¸­à¸”à¸ à¸±à¸¢  
à¸¡à¸µ `backtest` + `paper trading` + `daily journal` + `local dashboard` + `experiments harness` + `Binance Spot Testnet integration`

à¸„à¹ˆà¸²à¹€à¸£à¸´à¹ˆà¸¡à¸•à¹‰à¸™à¸„à¸·à¸­ `EXECUTION_MODE=paper` à¹à¸¥à¸° **à¹„à¸¡à¹ˆà¸ªà¹ˆà¸‡à¸­à¸­à¹€à¸”à¸­à¸£à¹Œà¸ˆà¸£à¸´à¸‡**

## à¸„à¸³à¹€à¸•à¸·à¸­à¸™à¸ªà¸³à¸„à¸±à¸
- à¹‚à¸›à¸£à¹€à¸ˆà¸à¸•à¹Œà¸™à¸µà¹‰à¹€à¸žà¸·à¹ˆà¸­à¸à¸²à¸£à¸¨à¸¶à¸à¸©à¸² à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸„à¸³à¹à¸™à¸°à¸™à¸³à¸à¸²à¸£à¸¥à¸‡à¸—à¸¸à¸™
- à¸«à¹‰à¸²à¸¡ commit à¹„à¸Ÿà¸¥à¹Œ `.env`
- à¸«à¹‰à¸²à¸¡à¹à¸Šà¸£à¹Œ `BINANCE_TESTNET_API_SECRET`
- à¸œà¸¥à¸¢à¹‰à¸­à¸™à¸«à¸¥à¸±à¸‡à¹„à¸¡à¹ˆà¸à¸²à¸£à¸±à¸™à¸•à¸µà¸­à¸™à¸²à¸„à¸•

## à¸•à¸´à¸”à¸•à¸±à¹‰à¸‡
```bash
npm install
```

## à¸•à¸±à¹‰à¸‡à¸„à¹ˆà¸² `.env`
à¸„à¸±à¸”à¸¥à¸­à¸ `.env.example` à¹€à¸›à¹‡à¸™ `.env` à¹à¸¥à¹‰à¸§à¹à¸à¹‰à¸„à¹ˆà¸²:

```env
EXECUTION_MODE=paper
BINANCE_TESTNET_BASE_URL=https://testnet.binance.vision/api
BINANCE_TESTNET_API_KEY=
BINANCE_TESTNET_API_SECRET=
BINANCE_TESTNET_RECV_WINDOW=5000
BINANCE_TESTNET_TRADING_ENABLED=NO
BINANCE_TESTNET_MAX_NOTIONAL=20
BINANCE_TESTNET_MAX_ORDERS_PER_MIN=5
```

à¸«à¸¡à¸²à¸¢à¹€à¸«à¸•à¸¸:
- à¸–à¹‰à¸²à¹ƒà¸Šà¹‰à¹à¸„à¹ˆ backtest/paper/journal/dashboard/experiments à¸ªà¸²à¸¡à¸²à¸£à¸–à¸›à¸¥à¹ˆà¸­à¸¢ API key/secret à¸§à¹ˆà¸²à¸‡à¹„à¸”à¹‰
- `.env` à¸–à¸¹à¸ ignore à¹ƒà¸™ git à¹à¸¥à¹‰à¸§

## à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¸«à¸¥à¸±à¸
```bash
npm run backtest -- --symbol BTCUSDT --interval 15m --limit 1000 --strategy smaCross
npm run paper -- --symbol BTCUSDT --interval 1m --strategy smaCross --pollMs 5000
npm run journal -- --input paper-log.jsonl --date 2026-02-13
npm run dashboard
npm run experiments -- --config configs/experiments.default.json
npm test
```

## Local Dashboard (React + Vite + TypeScript)
รองรับ Mobile / Tablet / Desktop และมี real-time SSE ในตัว

ติดตั้ง frontend dependencies (ครั้งแรก):
```bash
npm install --prefix apps/dashboard-ui
```

Dev mode (ใช้ 2 terminal):
Terminal 1:
```bash
npm run dashboard:server
```
Terminal 2:
```bash
npm run dashboard:ui
```
เปิดหน้า UI: `http://127.0.0.1:5173`

Build / Prod-friendly mode:
```bash
npm run dashboard:build
npm run dashboard:server
```
เปิดหน้า UI ผ่าน backend: `http://127.0.0.1:8787`

หมายเหตุ: backend จะ serve `apps/dashboard-ui/dist` อัตโนมัติถ้ามี build แล้ว

ฟีเจอร์หลัก:
- Top bar + status badges (Mode, Validate-only, SSE, Health)
- Theme toggle (Light/Dark) พร้อมจำค่าใน localStorage
- Summary cards + Equity/Drawdown charts พร้อม tooltip
- Trades table: search / filter / sort / pagination
- Live log drawer (mobile bottom sheet / desktop side panel)
- Setup Wizard พร้อม copy คำสั่ง backtest/paper/journal
- Toast notifications สำหรับ connected/reconnecting/disconnected

ความปลอดภัย:
- Dashboard นี้เพื่อการเรียนรู้ ไม่ส่งออเดอร์จริง
- ไม่ dump env/config ลับ และไม่แสดง API key/secret
- runtime endpoint ส่งเฉพาะข้อมูลปลอดภัย (`executionMode`, `validateOnly`)

Edge cases:
- ไม่มี `reports/latest.json` -> Empty state + CTA คำสั่ง backtest
- ไม่มี `paper-log.jsonl` -> แจ้งให้รัน paper ก่อน
- SSE หลุด -> แสดงสถานะ reconnect อัตโนมัติ

Dashboard QA checklist:
- Mobile 320-480px: layout ไม่ล้นจอ, table เลื่อนแนวนอนได้, drawer เปิด/ปิดได้
- Tablet 600-1024px: layout 2 คอลัมน์บางส่วน, chart อ่านง่าย
- Desktop >=1024px: grid สมดุลและใช้งานเร็ว
- Keyboard navigation และ focus ring ชัด
- ปุ่มสำคัญขนาดแตะ >=44px
## Experiment Harness (Batch Backtest)
à¸£à¸±à¸™à¹à¸šà¸šà¸£à¸°à¸šà¸¸ args:
```bash
npm run experiments -- --symbols BTCUSDT,ETHUSDT --intervals 15m,1h --strategies smaCross,rsiMeanReversion --limit 2000 --feeBps 10 --slippageBps 5
```

à¸£à¸±à¸™à¸ˆà¸²à¸ config:
```bash
npm run experiments -- --config configs/experiments.default.json
```

override à¸šà¸²à¸‡à¸„à¹ˆà¸²:
```bash
npm run experiments -- --config configs/experiments.default.json --feeBps 15 --top 10 --minTrades 20
```

à¸œà¸¥à¸¥à¸±à¸žà¸˜à¹Œà¸ˆà¸°à¸–à¸¹à¸à¸šà¸±à¸™à¸—à¸¶à¸à¸—à¸µà¹ˆ:
- `reports/experiments/YYYY-MM-DD_HH-mm-ss.json`
- `reports/experiments/details/*.json` (à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸” trades/equity à¹à¸¢à¸à¹„à¸Ÿà¸¥à¹Œ)

Summary table à¹ƒà¸™ console:
- columns: `symbol | interval | strategy | return% | maxDD% | win% | PF | trades | expectancy`
- sort default: `expectancy desc`
- marker: `TOP` à¹à¸¥à¸° `LOW`
- flags: `--top`, `--sort`, `--minTrades`

## Compare à¸œà¸¥à¸à¸²à¸£à¸—à¸”à¸¥à¸­à¸‡
```bash
npm run experiments:compare -- --a reports/experiments/A.json --b reports/experiments/B.json --key expectancy
```

à¸œà¸¥ compare:
- diff à¸•à¹ˆà¸­ entry (A/B/delta/trend)
- à¸ˆà¸³à¸™à¸§à¸™ improved/worsened/unchanged
- mean + median delta
- à¸£à¸²à¸¢à¸à¸²à¸£à¸—à¸µà¹ˆà¸‚à¸²à¸”/à¹€à¸à¸´à¸™à¸£à¸°à¸«à¸§à¹ˆà¸²à¸‡à¹„à¸Ÿà¸¥à¹Œ A/B

## à¸Šà¸¸à¸”à¸—à¸”à¸¥à¸­à¸‡à¸¡à¸²à¸•à¸£à¸à¸²à¸™ (à¹€à¸žà¸·à¹ˆà¸­à¹€à¸—à¸µà¸¢à¸šà¹à¸Ÿà¸£à¹Œ)
- à¹ƒà¸Šà¹‰à¸Šà¸¸à¸” symbols à¹€à¸”à¸´à¸¡à¸—à¸¸à¸à¸„à¸£à¸±à¹‰à¸‡ (à¹€à¸Šà¹ˆà¸™ BTCUSDT, ETHUSDT)
- à¹ƒà¸Šà¹‰ intervals à¹€à¸”à¸´à¸¡à¸—à¸¸à¸à¸„à¸£à¸±à¹‰à¸‡ (à¹€à¸Šà¹ˆà¸™ 15m, 1h)
- à¸¥à¹‡à¸­à¸à¸„à¹ˆà¸² fee/slippage à¹ƒà¸«à¹‰à¹€à¸—à¹ˆà¸²à¸à¸±à¸™
- à¹ƒà¸Šà¹‰ `limit` à¹€à¸—à¹ˆà¸²à¸à¸±à¸™
- à¹€à¸›à¸£à¸µà¸¢à¸šà¹€à¸—à¸µà¸¢à¸š report à¸—à¸µà¹ˆà¸ªà¸£à¹‰à¸²à¸‡à¹ƒà¸™à¸Šà¹ˆà¸§à¸‡à¹€à¸§à¸¥à¸²à¹ƒà¸à¸¥à¹‰à¸à¸±à¸™

## Paper Trading (à¸‚à¹‰à¸²à¸¡à¸„à¸·à¸™)
```bash
npm run paper -- --symbol BTCUSDT --interval 1m --strategy smaCross --pollMs 5000 --maxNotional 20 --dailyMaxLoss 2 --maxTradesPerHour 20 --cooldownMs 120000
```

## Testnet CLI
```bash
npm run testnet:ping
npm run testnet:time
npm run testnet:account
npm run testnet:order:test -- --symbol BTCUSDT --side BUY --type MARKET --quoteOrderQty 10
npm run testnet:ws:userdata -- --durationMs 30000
npm run testnet:smoke -- --durationMs 15000
```

### Safety Switch 4 à¸Šà¸±à¹‰à¸™ (à¸ªà¸³à¸«à¸£à¸±à¸š `/api/v3/order` à¸ˆà¸£à¸´à¸‡à¸šà¸™ testnet)
- A: default `EXECUTION_MODE=paper`
- B: à¸•à¹‰à¸­à¸‡à¸•à¸±à¹‰à¸‡ `EXECUTION_MODE=testnet`
- C: à¸•à¹‰à¸­à¸‡à¸•à¸±à¹‰à¸‡ `BINANCE_TESTNET_TRADING_ENABLED=YES`
- D: à¸•à¹‰à¸­à¸‡à¸ªà¹ˆà¸‡ `--i-know-what-im-doing=YES`

à¸–à¹‰à¸²à¹„à¸¡à¹ˆà¸„à¸£à¸š à¸£à¸°à¸šà¸šà¸ˆà¸° reject à¸—à¸±à¸™à¸—à¸µ

## Daily Journal
```bash
npm run journal -- --input paper-log.jsonl --date 2026-02-13
npm run journal -- --input reports/latest.json
```

## à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡à¸ªà¸³à¸„à¸±à¸
- `src/experiments/runner.ts` à¸£à¸±à¸™ matrix
- `src/experiments/config.ts` à¹‚à¸«à¸¥à¸” config + override + validate
- `src/experiments/metrics.ts` à¸„à¸³à¸™à¸§à¸“ metrics à¹€à¸ªà¸£à¸´à¸¡
- `src/experiments/table.ts` render summary table
- `src/experiments/compare.ts` compare 2 reports
- `src/dashboard/server.ts` static + API + SSE

## à¸—à¸”à¸ªà¸­à¸š
```bash
npm test
```

## Monitoring + Replay (Dashboard)
ฟีเจอร์นี้อยู่ใน React dashboard และใช้ข้อมูลจาก backend เดิม (`/api/*` + `/api/paper/stream`) โดยไม่เปิดเผย secret/env

สิ่งที่ Monitoring tab แสดง:
- สถานะ SSE: connected/reconnecting/disconnected + เวลา event ล่าสุด
- Errors/min (30 นาทีล่าสุด)
- Risk rejects/min (30 นาทีล่าสุด) + สาเหตุ reject ที่พบบ่อย
- จำนวน RATE_LIMIT hits
- เหตุการณ์ KILL_SWITCH ล่าสุด
- Alert rules ฝั่ง client (ปรับ threshold ได้)
- Alerts history (สูงสุด 50 รายการ) + Acknowledge/Clear/Export JSON

สิ่งที่ Replay tab ทำได้:
- เลือกช่วงเวลา: Last 1h / 6h / 24h / custom
- โหลดข้อมูลย้อนหลังผ่าน `/api/paper/read`
- ควบคุม timeline: Play/Pause, Step +1/-1, Speed 1x/2x/5x/10x
- Scrubber สำหรับ seek ตาม index
- Filter ตาม event type + search จาก message/meta
- Snapshot ระหว่าง replay: position/cash/equity/last trade/last reject (ถ้า log มีข้อมูลพอ)

วิธีใช้งานแบบเร็ว:
1. รัน backend dashboard server
2. รัน React UI dev server
3. เปิดแท็บ Monitoring เพื่อตรวจ error/reject/alerts แบบ real-time
4. เปิดแท็บ Replay แล้วกด Load เพื่อ debug ช่วงเวลาที่ต้องการ

คำสั่ง:
```bash
npm run dashboard:server
npm run dashboard:ui
```

หมายเหตุด้านความปลอดภัย:
- Dashboard นี้เพื่อการเรียนรู้ ไม่ใช่คำแนะนำการลงทุน
- ระบบไม่ dump `process.env` และไม่แสดง API key/secret
- runtime status endpoint ส่งเฉพาะ `mode`, `validateOnly`, `ts`
- ค่า default ยังเป็น `EXECUTION_MODE=paper` (ไม่ส่งออเดอร์จริง)

Dashboard checklist เพิ่มเติม:
- Monitoring counters เพิ่มขึ้นเมื่อมี SSE events ใหม่
- ถ้า SSE หลุด ควรเห็นสถานะเปลี่ยน + toast reconnect
- Replay load แล้วควบคุม play/pause/seek ได้ deterministic
- ถ้า log ไม่พอ snapshot จะแสดง `N/A` (ไม่เดาข้อมูล)

ดูแนวทางแก้ปัญหาเพิ่มเติมใน `TROUBLESHOOTING.md`


