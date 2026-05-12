/**
 * FINFLOW AI — LINE Bot (POC v4 - SQLite Edition)
 * Persona: FIN — เพื่อนที่รู้เรื่องเงิน
 */
const express   = require('express');
const line      = require('@line/bot-sdk');
const Anthropic = require('@anthropic-ai/sdk');
const Database  = require('better-sqlite3');
require('dotenv').config();

// Initialize Database
const db = new Database('finflow.db');
db.pragma('journal_mode = WAL'); // Better concurrent access

// Create tables if not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    isIncome INTEGER NOT NULL,
    description TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    UNIQUE(userId, createdAt, amount, description)
  );

  CREATE TABLE IF NOT EXISTS user_state (
    userId TEXT PRIMARY KEY,
    state TEXT DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_user_date ON transactions(userId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_user_month ON transactions(userId, substr(createdAt, 1, 7));
`);

// Prepared statements for better performance
const insertTxn = db.prepare(`
  INSERT OR IGNORE INTO transactions (userId, amount, category, isIncome, description, createdAt)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const getTxnsByUser = db.prepare(`
  SELECT * FROM transactions 
  WHERE userId = ? 
  ORDER BY createdAt DESC
`);

const getTxnsThisMonth = db.prepare(`
  SELECT * FROM transactions 
  WHERE userId = ? 
    AND substr(createdAt, 1, 7) = ?
  ORDER BY createdAt DESC
`);

const getTxnsToday = db.prepare(`
  SELECT * FROM transactions 
  WHERE userId = ? 
    AND date(createdAt) = date('now', 'localtime')
`);

const getUserState = db.prepare(`SELECT state FROM user_state WHERE userId = ?`);
const setUserState = db.prepare(`
  INSERT INTO user_state (userId, state) VALUES (?, ?)
  ON CONFLICT(userId) DO UPDATE SET state = excluded.state
`);

// LINE & Anthropic setup
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret:      process.env.LINE_CHANNEL_SECRET,
};
const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();

const CATEGORY_EMOJI = {
  'อาหาร & เครื่องดื่ม': '🍽️',
  'การเดินทาง':           '🚗',
  'ช้อปปิ้ง':             '🛍️',
  'สุขภาพ':               '🏥',
  'บันเทิง':              '🎬',
  'ที่พัก / บ้าน':        '🏠',
  'โทรศัพท์ / อินเทอร์เน็ต': '📱',
  'รายรับ':               '💰',
  'อื่นๆ':                '📌',
};

const CATEGORY_COLOR = {
  'อาหาร & เครื่องดื่ม': '#FF6B6B',
  'การเดินทาง':           '#06C755',
  'ช้อปปิ้ง':             '#A29BFE',
  'สุขภาพ':               '#00CEC9',
  'บันเทิง':              '#FDCB6E',
  'ที่พัก / บ้าน':        '#74B9FF',
  'โทรศัพท์ / อินเทอร์เน็ต': '#E17055',
  'รายรับ':               '#00B894',
  'อื่นๆ':                '#B2BEC3',
};

async function classifyExpense(text) {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `จำแนกรายรับ-รายจ่ายจากข้อความ: "${text}"
ตอบ JSON เท่านั้น ห้าม backtick:
{"amount":<number>,"category":"<cat>","isIncome":<bool>,"description":"<max 20 chars>"}
หมวด: "อาหาร & เครื่องดื่ม","การเดินทาง","ช้อปปิ้ง","สุขภาพ","บันเทิง","ที่พัก / บ้าน","โทรศัพท์ / อินเทอร์เน็ต","รายรับ","อื่นๆ"
รายรับ → isIncome:true, category:"รายรับ" | ไม่ใช่การเงิน → amount:0`,
    }],
  });
  return JSON.parse(msg.content[0].text);
}

function push(userId, messages) {
  if (typeof messages === 'string') {
    messages = [{ type: 'text', text: messages }];
  }
  return lineClient.pushMessage({ to: userId, messages });
}

function buildResultCard(result, userId) {
  const today = getTxnsToday.all(userId);
  const todaySpent = today.filter(t => !t.isIncome).reduce((s,t) => s + t.amount, 0);
  const emoji = CATEGORY_EMOJI[result.category] || '📌';
  const color = CATEGORY_COLOR[result.category] || '#B2BEC3';
  const isIncome = result.isIncome;

  return {
    type: 'flex',
    altText: `${isIncome ? '+' : '-'}฿${result.amount.toLocaleString()} | ${result.description}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: isIncome ? '#00B894' : color,
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: emoji + '  ' + result.category,
            color: '#ffffff',
            size: 'sm',
            weight: 'bold'
          },
          {
            type: 'text',
            text: result.description,
            color: '#ffffff',
            size: 'xs'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: (isIncome ? '+' : '-') + '฿' + result.amount.toLocaleString(),
            size: 'xxl',
            weight: 'bold',
            color: isIncome ? '#00B894' : '#FF6B6B'
          },
          {
            type: 'text',
            text: '✅ FIN บันทึกแล้วนะ',
            size: 'sm',
            color: '#aaaaaa'
          },
          {
            type: 'separator',
            margin: 'md'
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'md',
            contents: [
              {
                type: 'text',
                text: '💸 วันนี้: ฿' + todaySpent.toLocaleString(),
                size: 'sm',
                color: '#555555',
                flex: 1
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        paddingAll: '12px',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            action: { type: 'message', label: '📊 สรุป', text: 'สรุป' },
            style: 'primary',
            color: '#06C755',
            flex: 1
          },
          {
            type: 'button',
            action: { type: 'message', label: '🤖 FIN วิเคราะห์', text: 'AI วิเคราะห์' },
            style: 'secondary',
            flex: 1
          }
        ]
      }
    }
  };
}

function getMonthSummary(userId) {
  const now = new Date();
  const yearMonth = now.toISOString().substring(0, 7); // YYYY-MM
  const txns = getTxnsThisMonth.all(userId, yearMonth);
  
  const spent = txns.filter(t => !t.isIncome).reduce((s,t) => s + t.amount, 0);
  const income = txns.filter(t => t.isIncome).reduce((s,t) => s + t.amount, 0);
  
  const cats = {};
  txns.filter(t => !t.isIncome).forEach(t => {
    cats[t.category] = (cats[t.category] || 0) + t.amount;
  });
  const topCats = Object.entries(cats).sort((a,b) => b[1]-a[1]).slice(0,4);
  const monthName = now.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

  const catRows = topCats.map(([cat, amt]) => ({
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: (CATEGORY_EMOJI[cat]||'📌') + ' ' + cat, size: 'sm', color: '#444444', flex: 4 },
      { type: 'text', text: '฿' + amt.toLocaleString(), size: 'sm', color: CATEGORY_COLOR[cat]||'#333', align: 'end', flex: 2, weight: 'bold' }
    ]
  }));

  return {
    type: 'flex',
    altText: '📊 สรุปการเงิน ' + monthName,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1A1A2E',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: '📊  FINFLOW AI', color: '#06C755', size: 'sm', weight: 'bold' },
          { type: 'text', text: 'FIN สรุปให้แล้วนะ', color: '#ffffff', size: 'md', weight: 'bold' },
          { type: 'text', text: monthName + ' • ' + txns.length + ' รายการ', color: '#aaaaaa', size: 'xs' }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  { type: 'text', text: '💸 รายจ่าย', size: 'xs', color: '#aaaaaa' },
                  { type: 'text', text: '฿' + spent.toLocaleString(), size: 'lg', weight: 'bold', color: '#FF6B6B' }
                ]
              },
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  { type: 'text', text: '💰 รายรับ', size: 'xs', color: '#aaaaaa' },
                  { type: 'text', text: '฿' + income.toLocaleString(), size: 'lg', weight: 'bold', color: '#00B894' }
                ]
              }
            ]
          },
          { type: 'separator' },
          ...catRows
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        contents: [{
          type: 'button',
          action: { type: 'message', label: '🤖 FIN วิเคราะห์', text: 'AI วิเคราะห์' },
          style: 'primary',
          color: '#1A1A2E'
        }]
      }
    }
  };
}

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  res.status(200).json({ status: 'ok' });

  for (const event of req.body.events || []) {
    const userId = event.source?.userId;
    if (!userId) continue;

    if (event.type === 'follow') {
      await push(userId, `ยินดีต้อนรับสู่ FINFLOW AI! 💳\n\n👋 สวัสดี! FIN ช่วยบันทึกรายรับ-จ่ายให้\n\nพิมพ์รายการ + จำนวนเงิน เช่น\n• กาแฟ 65\n• Grab 95\n• เงินเดือน 35000\n\n📊 สรุป\n🤖 FIN วิเคราะห์\n❓ วิธีใช้`);
      continue;
    }

    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const text = event.message.text.trim();
    const t = text.toLowerCase();

    // Handle user state
    const stateRow = getUserState.get(userId);
    const state = stateRow ? JSON.parse(stateRow.state) : {};
    
    if (state.awaitingBudget) {
      const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
      setUserState.run(userId, '{}');
      await push(userId, !isNaN(num) && num > 0
        ? `✅ FIN ตั้งงบ ฿${num.toLocaleString()}/เดือนให้แล้วนะ!`
        : '❌ กรุณาพิมพ์ตัวเลข เช่น 20000');
      continue;
    }

    if (['สรุป', 'สรุปเดือนนี้', 'summary'].includes(t)) {
      const txns = getTxnsByUser.all(userId);
      await push(userId, txns.length === 0
        ? [{ type: 'text', text: '📭 ยังไม่มีรายการนะ\nลองพิมพ์ เช่น กาแฟ 65' }]
        : [getMonthSummary(userId)]);
      continue;
    }

    if (['ai วิเคราะห์', 'ai', 'วิเคราะห์', 'fin วิเคราะห์'].includes(t)) {
      const txns = getTxnsByUser.all(userId);
      if (txns.length < 3) {
        await push(userId, '📊 FIN ต้องการรายการอย่างน้อย 3 รายการนะ');
        continue;
      }
      await push(userId, '🤖 FIN กำลังวิเคราะห์...');
      try {
        const cats = {};
        txns.forEach(t => { if (!t.isIncome) cats[t.category] = (cats[t.category]||0) + t.amount; });
        const spent = txns.filter(t=>!t.isIncome).reduce((s,t)=>s+t.amount,0);
        const income = txns.filter(t=>t.isIncome).reduce((s,t)=>s+t.amount,0);
        const msg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: `คุณคือ FIN เพื่อนที่รู้เรื่องเงิน พูดแบบเป็นกันเอง ไม่ตัดสิน
วิเคราะห์การเงิน: รายจ่าย:฿${spent} รายรับ:฿${income} หมวด:${Object.entries(cats).map(([c,v])=>`${c}:฿${v}`).join(',')||'ไม่มี'}
ตอบสั้นๆ 2-3 บรรทัด ห้ามใช้ markdown ห้าม ** ห้าม # พูดแบบเพื่อน`
          }]
        });
        await push(userId, `🤖 FIN วิเคราะห์\n━━━━━━━━━━━━\n${msg.content[0].text}`);
      } catch(e) {
        await push(userId, '❌ เกิดข้อผิดพลาด ลองใหม่นะ');
      }
      continue;
    }

    if (['วิธีใช้', 'help'].includes(t)) {
      await push(userId, `💡 วิธีใช้ FINFLOW AI\n\n📝 บันทึกรายจ่าย:\n→ กาแฟ 65\n→ Grab 95\n→ ค่าไฟ 850\n\n💰 บันทึกรายรับ:\n→ เงินเดือน 35000\n\n📊 สรุป\n🤖 FIN วิเคราะห์`);
      continue;
    }

    // AI Classify
    try {
      const result = await classifyExpense(text);
      if (!result.amount || result.amount === 0) {
        await push(userId, '🤔 FIN ไม่แน่ใจนะ\nพิมพ์: ชื่อ + จำนวนเงิน เช่น กาแฟ 65');
        continue;
      }
      
      insertTxn.run(
        userId,
        result.amount,
        result.category,
        result.isIncome ? 1 : 0,
        result.description,
        new Date().toISOString()
      );
      
      await push(userId, [buildResultCard(result, userId)]);
    } catch(e) {
      console.error('[Error]', e.status, JSON.stringify(e.error));
      await push(userId, '❌ เกิดข้อผิดพลาด ลองใหม่นะ');
    }
  }
});

app.get('/', (req, res) => res.json({ service: 'FINFLOW AI', status: 'running', db: 'SQLite' }));

app.get('/health', (req, res) => {
  try {
    const count = db.prepare('SELECT COUNT(*) as total FROM transactions').get();
    res.json({ status: 'ok', totalTransactions: count.total, database: 'finflow.db' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 FINFLOW AI LINE Bot v4.0 (SQLite Edition)`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Database: finflow.db`);
  console.log(`   Persona: FIN — เพื่อนที่รู้เรื่องเงิน\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  console.log('\n✅ Database closed gracefully');
  process.exit(0);
});