/**
 * FINFLOW AI — Rich Menu Setup Script
 * รันครั้งเดียวเพื่อสร้าง Rich Menu บน LINE
 *
 * Usage:
 *   node setup-rich-menu.js
 */

require('dotenv').config();
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!TOKEN) { console.error('❌ ไม่พบ LINE_CHANNEL_ACCESS_TOKEN ใน .env'); process.exit(1); }

// ─────────────────────────────────────────────────────────────────
// Rich Menu Definition  (2500 × 843 px — half height)
// Buttons: สรุป | AI วิเคราะห์ | แอปธนาคาร | ตั้งค่า | บันทึก | วิธีใช้
// ─────────────────────────────────────────────────────────────────
const RICH_MENU = {
  size:        { width: 2500, height: 843 },
  selected:    true,
  name:        'FINFLOW AI Main Menu',
  chatBarText: '💳 FINFLOW AI',
  areas: [
    // Row 1
    {
      bounds: { x: 0,    y: 0, width: 833, height: 422 },
      action: { type: 'message', label: '📊 สรุปเดือนนี้', text: 'สรุปเดือนนี้' },
    },
    {
      bounds: { x: 833,  y: 0, width: 834, height: 422 },
      action: { type: 'message', label: '🤖 AI วิเคราะห์', text: 'AI วิเคราะห์' },
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 422 },
      action: { type: 'message', label: '🏦 แอปธนาคาร', text: 'แอปธนาคาร' },
    },
    // Row 2
    {
      bounds: { x: 0,    y: 422, width: 833, height: 421 },
      action: { type: 'message', label: '⚙️ ตั้งค่า', text: 'ตั้งค่า' },
    },
    {
      bounds: { x: 833,  y: 422, width: 834, height: 421 },
      action: { type: 'message', label: '📝 บันทึก', text: 'วิธีบันทึก' },
    },
    {
      bounds: { x: 1667, y: 422, width: 833, height: 421 },
      action: { type: 'message', label: '❓ วิธีใช้', text: 'วิธีใช้' },
    },
  ],
};

// ─────────────────────────────────────────────────────────────────
// API helper
// ─────────────────────────────────────────────────────────────────
function lineAPI(method, path, body, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const isBuffer = Buffer.isBuffer(body);
    const postData = isBuffer ? body : (body ? JSON.stringify(body) : null);
    const options  = {
      hostname: 'api.line.me',
      path,
      method,
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        'Content-Type': contentType,
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────
// Generate simple Rich Menu image using HTML canvas (via script)
// or provide instructions to upload manually
// ─────────────────────────────────────────────────────────────────
async function generatePlaceholderImage() {
  // Check if rich-menu.png exists (user can prepare their own)
  const imgPath = path.join(__dirname, 'rich-menu.png');
  if (fs.existsSync(imgPath)) {
    console.log('✅ พบไฟล์ rich-menu.png — จะใช้ไฟล์นี้');
    return fs.readFileSync(imgPath);
  }

  // Try to generate using jimp if available
  try {
    const Jimp = require('jimp');
    console.log('🎨 กำลังสร้าง Rich Menu Image ด้วย Jimp...');
    const img = new Jimp(2500, 843, 0x1A1A2Eff);

    // Load font
    const font = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);

    const cells = [
      { x: 0,    y: 0,   w: 833,  h: 422, icon: '>>',    label: 'สรุปเดือนนี้',  color: 0x06C755ff },
      { x: 833,  y: 0,   w: 834,  h: 422, icon: '[AI]',  label: 'AI วิเคราะห์', color: 0x4E54C8ff },
      { x: 1667, y: 0,   w: 833,  h: 422, icon: '[$$]',  label: 'แอปธนาคาร',    color: 0x1e4d9bff },
      { x: 0,    y: 422, w: 833,  h: 421, icon: '[>]',   label: 'ตั้งค่า',       color: 0x444444ff },
      { x: 833,  y: 422, w: 834,  h: 421, icon: '[+]',   label: 'บันทึก',        color: 0x06C755ff },
      { x: 1667, y: 422, w: 833,  h: 421, icon: '[?]',   label: 'วิธีใช้',       color: 0x555555ff },
    ];

    for (const c of cells) {
      // Cell background
      const cell = new Jimp(c.w - 4, c.h - 4, c.color);
      img.composite(cell, c.x + 2, c.y + 2);
      // Label
      img.print(font, c.x + 20, c.y + c.h / 2 - 40, c.label, c.w - 40);
    }

    const buf = await img.getBufferAsync(Jimp.MIME_PNG);
    fs.writeFileSync(imgPath, buf);
    console.log('✅ สร้าง rich-menu.png สำเร็จ');
    return buf;

  } catch {
    console.log('\n⚠️  ไม่พบ Jimp — ต้องเตรียมรูป Rich Menu เอง');
    console.log('📐 ขนาดที่ต้องการ: 2500 × 843 px (PNG)');
    console.log('🎨 ออกแบบที่ Canva / Figma แล้วบันทึกเป็น rich-menu.png');
    console.log('   จากนั้นรัน: node setup-rich-menu.js อีกครั้ง\n');
    console.log('💡 หรืออัปโหลดผ่าน LINE Official Account Manager:');
    console.log('   https://manager.line.biz → Rich Menus → Create\n');
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Main Setup Flow
// ─────────────────────────────────────────────────────────────────
async function setup() {
  console.log('\n🚀 FINFLOW AI — Rich Menu Setup\n');

  // 1. Delete existing rich menus
  console.log('1️⃣  ลบ Rich Menu เก่า...');
  const listRes = await lineAPI('GET', '/v2/bot/richmenu/list');
  if (listRes.body.richmenus) {
    for (const rm of listRes.body.richmenus) {
      await lineAPI('DELETE', `/v2/bot/richmenu/${rm.richMenuId}`);
      console.log(`   ลบ ${rm.richMenuId} แล้ว`);
    }
  }

  // 2. Create rich menu
  console.log('\n2️⃣  สร้าง Rich Menu...');
  const createRes = await lineAPI('POST', '/v2/bot/richmenu', RICH_MENU);
  if (createRes.status !== 200) {
    console.error('❌ สร้าง Rich Menu ไม่สำเร็จ:', createRes.body);
    process.exit(1);
  }
  const richMenuId = createRes.body.richMenuId;
  console.log(`   ✅ สร้างแล้ว: ${richMenuId}`);

  // 3. Upload image
  console.log('\n3️⃣  อัปโหลดรูป Rich Menu...');
  const imgBuffer = await generatePlaceholderImage();

  if (imgBuffer) {
    const uploadRes = await lineAPI(
      'POST',
      `/v2/bot/richmenu/${richMenuId}/content`,
      imgBuffer,
      'image/png'
    );
    if (uploadRes.status === 200) {
      console.log('   ✅ อัปโหลดรูปสำเร็จ');
    } else {
      console.warn('   ⚠️  อัปโหลดรูปไม่สำเร็จ:', uploadRes.body);
    }
  }

  // 4. Set as default
  console.log('\n4️⃣  ตั้งเป็น Default Rich Menu...');
  const setRes = await lineAPI('POST', `/v2/bot/user/all/richmenu/${richMenuId}`);
  if (setRes.status === 200) {
    console.log('   ✅ ตั้งเป็น Default แล้ว');
  } else {
    console.warn('   ⚠️ :', setRes.body);
  }

  console.log(`
╔════════════════════════════════════╗
║  ✅  Rich Menu Setup สำเร็จ!      ║
║  ID: ${richMenuId.substring(0, 32)} ║
╚════════════════════════════════════╝

📱 Rich Menu จะแสดงใน LINE ภายใน 1-2 นาที
🎨 ถ้าต้องการเปลี่ยนรูป ให้วาง rich-menu.png
   แล้วรัน node setup-rich-menu.js ใหม่
`);
}

setup().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
