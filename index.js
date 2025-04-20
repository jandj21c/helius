// 📦 환경변수 로드
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const MY_TOKEN = process.env.YOUR_TOKEN_ADDRESS; // MOON Token Mint
const MY_LP_POOL_ADDRESS = 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL'; // 하드코딩된 LP Pool 주소

app.use(bodyParser.json());

// ✅ Birdeye에서 실시간 가격 조회
async function getTokenPriceUsd(tokenMint) {
  try {
    const res = await axios.get('https://public-api.birdeye.so/public/price', {
      params: { address: tokenMint },
      headers: { 'X-API-KEY': process.env.BIRDEYE_API_KEY || '' },
    });
    return res.data?.data?.value || 0;
  } catch (e) {
    console.error("❌ Birdeye 가격 조회 실패:", e.message);
    return 0;
  }
}

// ✅ 텔레그램으로 비디오 또는 이미지 전송
async function sendTelegram(text, mediaPath) {
  const ext = path.extname(mediaPath).toLowerCase();
  const isVideo = ['.mp4', '.mov', '.webm'].includes(ext);

  const url = isVideo
    ? `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendVideo`
    : `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`;

  const form = new FormData();
  form.append('chat_id', process.env.TELEGRAM_CHAT_ID);
  form.append(isVideo ? 'video' : 'photo', fs.createReadStream(mediaPath));
  form.append('caption', text);
  form.append('parse_mode', 'Markdown');

  try {
    const res = await axios.post(url, form, {
      headers: form.getHeaders()
    });
    console.log('✅ 미디어와 함께 메시지 전송 성공');
  } catch (err) {
    console.error('❌ 전송 실패:', err.response?.data || err.message);
  }
}

// ✅ Webhook 수신
app.post('/webhook', async (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : [req.body];

  //console.log("📥 수신된 Webhook 데이터:", JSON.stringify(payload, null, 2));
  console.log("📥 헬리어스 이벤트 수신");

  for (const data of payload) {
    const source = (data.source || '').toLowerCase();
    const transfers = data.tokenTransfers || [];
    const swap = data.events?.swap;

    let buy;
    if (source === 'jupiter' && swap?.tokenOutputs?.length) {
      buy = swap.tokenOutputs.find(t => t.mint === MY_TOKEN && t.toUserAccount !== MY_LP_POOL_ADDRESS);
    } else {
      buy = transfers.find(t =>
        t.mint === MY_TOKEN &&
        t.toUserAccount !== t.fromUserAccount &&
        t.toUserAccount !== MY_LP_POOL_ADDRESS &&
        Number(t.tokenAmount) > 0
      );
    }

    if (!buy) {
      console.log("🧐 MOON 매수 아님 → 무시됨");
      continue;
    }

    const buyer = buy.userAccount || buy.toUserAccount;
    const tokenAmount = Number(buy.tokenAmount || buy.rawTokenAmount?.tokenAmount / 1e9);

    let solPaid, usdcPaid, solAmount = 0;
    if (source === 'jupiter' && swap?.tokenInputs?.length) {
      solPaid = swap.tokenInputs.find(t => t.mint === 'So11111111111111111111111111111111111111112');
      usdcPaid = swap.tokenInputs.find(t => t.tokenSymbol === 'USDC');
    } else {
      solPaid = transfers.find(t => t.mint === 'So11111111111111111111111111111111111111112' && t.fromUserAccount === buyer);
      usdcPaid = transfers.find(t => t.tokenSymbol === 'USDC' && t.fromUserAccount === buyer);
    }

    let paymentText = '';
    let passesThreshold = false;

    if (usdcPaid) {
      const usdcAmount = Number(usdcPaid.tokenAmount || usdcPaid.rawTokenAmount?.tokenAmount / 1e6);
      paymentText = `${usdcAmount.toFixed(2)} USDC`;
      passesThreshold = usdcAmount >= 10;
    } else if (solPaid) {
      solAmount = Number(solPaid.tokenAmount || solPaid.rawTokenAmount?.tokenAmount / 1e9);
      paymentText = `${solAmount.toFixed(4)} SOL`;
      passesThreshold = solAmount >= 0.00001;
    }

    if (!passesThreshold) {
      console.log("⏹️ 알림 조건 미달: 소액 거래 무시");
      continue;
    }

    // 💱 Birdeye를 통한 MOON 현재 시세 (USD 기준)
    const moonPriceUsd = await getTokenPriceUsd(MY_TOKEN);
    const totalUsd = tokenAmount * moonPriceUsd;

    const emoji = tokenAmount > 10000 ? "🐳" : tokenAmount > 1000 ? "🦈" : "🟢";
    const signature = data.signature;
    const solscanUrl = `https://solscan.io/tx/${signature}`;
    const timestamp = new Date(data.timestamp * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

    let mediaPath;
    let title;
    if (solAmount > 20) {
      mediaPath = path.join(__dirname, 'images', 'big_whale.jpg');
      title = '🐋🐋🐋대왕고래 출현🐋🐋🐋';
    } else {
      mediaPath = path.join(__dirname, 'images', 'small_whale.jpg');
      title = 'BUY Detected!';
    }

    const msg = `💰 *${source.toUpperCase()} ${title}*
👤 Buyer : \`${buyer.slice(0, 6)}...${buyer.slice(-4)}\`
🪙 Amount: ${emoji} ${tokenAmount.toFixed(2)} MOON
💵 Payment: ${paymentText}
💲 Price: $${moonPriceUsd.toFixed(6)} / ${buy.tokenSymbol}
💰 Cap:   $${totalUsd.toFixed(2)} USD
🕒 Time:  ${timestamp}
🔗 [View on Solscan](${solscanUrl})`;

    console.log("❤️거래 텔레그램에 전송");
    await sendTelegram(msg, mediaPath);
  }

  res.sendStatus(200);
});

// ✅ 서버 시작
app.listen(PORT, () => {
  console.log(`🚀 Webhook 수신 서버 실행 중: Port :${PORT}`);
});
