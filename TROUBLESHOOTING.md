# Troubleshooting (Dashboard Monitoring + Replay)

## 1) SSE ไม่เชื่อมต่อ (`disconnected` หรือ `reconnecting` นานผิดปกติ)
- ตรวจว่า backend รันอยู่: `npm run dashboard:server`
- ตรวจว่า UI dev server รันอยู่: `npm run dashboard:ui`
- ถ้าใช้ dev mode ให้เช็คว่า Vite proxy ชี้ไป `http://127.0.0.1:8787`
- ตรวจ firewall/antivirus ว่าไม่บล็อก localhost port 8787/5173
- เปิด `http://127.0.0.1:8787/api/health` ต้องได้ `{ ok: true }`
- เปิด `http://127.0.0.1:8787/api/paper/stream` ต้องเห็น SSE comment/event กลับมา

## 2) Live log ไม่ขึ้น / Monitoring ไม่มี event
- ต้องมีไฟล์ `paper-log.jsonl` ก่อน
- ให้รัน paper mode เพื่อสร้าง log:
```bash
npm run paper -- --symbol BTCUSDT --interval 1m --strategy smaCross --pollMs 5000
```
- ตรวจ endpoint tail:
`GET /api/paper/tail?lines=50`
- ถ้า log บางบรรทัดเสีย ระบบจะข้ามบรรทัดนั้นโดยไม่ crash

## 3) Replay โหลดไม่ได้ หรือข้อมูลน้อยเกินไป
- ตรวจว่า `paper-log.jsonl` มีข้อมูลในช่วงเวลาที่เลือก
- ลองเพิ่มช่วงเวลาเป็น Last 6h/24h
- เพิ่ม `maxLines` (เช่น 5000 -> 10000)
- ตรวจ endpoint:
`GET /api/paper/read?from=<ms>&to=<ms>&maxLines=5000`
- ถ้าไฟล์ไม่พบ จะได้ 404 พร้อมข้อความแนะนำให้รัน paper ก่อน

## 4) UI หน่วงเมื่อ log มาเร็ว
- ลดจำนวน event ที่ดึงย้อนหลังใน Replay (`maxLines`)
- ลดจำนวน event ใน memory (เช่นปรับค่าจำกัด events/log lines ใน UI)
- ใช้ filter/search ให้แคบลงเพื่อลดงาน render
- ปิดแท็บ Replay ชั่วคราวถ้าไม่ได้ใช้งาน

## 5) Build ไม่ผ่าน
- รัน dependencies ฝั่ง UI ก่อน:
```bash
npm install --prefix apps/dashboard-ui
```
- ทดสอบเฉพาะ UI:
```bash
npm --prefix apps/dashboard-ui run test
npm --prefix apps/dashboard-ui run build
```
- ทดสอบทั้งโปรเจกต์:
```bash
npm test
```

## 6) Security checks ที่ควรยืนยัน
- ไม่มี endpoint ที่ dump env/config ทั้งก้อน
- `/api/runtime/status` ส่งเฉพาะ `mode`, `validateOnly`, `ts`
- หน้า dashboard ไม่มีการแสดง API key/secret
- execution default เป็น `paper` และไม่ส่งออเดอร์จริง

