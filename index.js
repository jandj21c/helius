require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT;
const MY_TOKEN = process.env.YOUR_TOKEN_ADDRESS;

app.use(bodyParser.json());

// 웹훅 처리 엔드포인트
app.post('/webhook', async (req, res) => {
  const data = req.body;

  if (data.type !== 'SWAP' || data.source !== 'raydium') {
    return res.sendStatus(200);
  }

  const transfers = data.tokenTransfers || [];

  // 내 토큰을 받은 전송 (매수자에게)
  const buy = transfers.find(t => 
    t.mint === MY_TOKEN &&
    t.destinationOwner !== t.sourceOwner &&
    parseFloat(t.amount) > 0
  );

  // USDC를 보내는 트랜잭션도 있으면 확실한 매수
  const paid = transfers.find(t => 
    t.tokenSymbol === 'USDC' &&
    t.sourceOwner === buy?.destinationOwner
  );

  if (buy && paid) {
    const amount = Number(buy.amount) / Math.pow(10, buy.decimals || 9);
    const buyer = buy.destinationOwner;
    const usdcAmount = Number(paid.amount) / Math.pow(10, paid.decimals || 6);

    const msg = `💰 *Raydium 매수 발생!*
👤 바이어: \`${buyer.slice(0, 6)}...${buyer.slice(-4)}\`
🪙 수량: ${amount.toFixed(2)} ${buy.tokenSymbol}
💵 지불: ${usdcAmount.toFixed(2)} USDC`;

    await sendTelegram(msg);
  }

  res.sendStatus(200);
});

// 텔레그램 알림 전송
async function sendTelegram(text) {
  const BOT = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT = process.env.TELEGRAM_CHAT_ID;
  const url = `https://api.telegram.org/bot${BOT}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: CHAT,
      text,
      parse_mode: "Markdown"
    });
    console.log("✅ 알림 전송:", text);
  } catch (e) {
    console.error("❌ 텔레그램 전송 실패:", e.message);
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Webhook 서버 실행 중: http://localhost:${PORT}`);
});
