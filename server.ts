import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

// Gemini AI client initialization
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// API to parse unstructured text / invoice image into 10-column template format
app.post('/api/parse-invoice', async (req, res) => {
  try {
    const { text, imageBase64, mimeType } = req.body;

    if (!ai) {
      return res.status(503).json({
        error: '未配置 GEMINI_API_KEY，请使用文本直接导入或在环境变量中设置 GEMINI_API_KEY。',
      });
    }

    const prompt = `请将以下提供的进货单文本或图片，准确解析并转换为标准的10列采购清单JSON数组。
目标字段对应关系：
1. seq (number): 序号 (如无则从1开始顺序递增)
2. name (string): 品名 / 原文品名
3. chineseName (string): 中文品名或规格说明
4. unitPrice (number): 单价 (数值，无货币符号)
5. discountPrice (number): 优惠价 / 协议价 (数值，若无则与单价相同或为0)
6. barcode (string): 条形码 (69码/EAN/UPC，纯字符串)
7. expectedQty (number): 进货数量 (整数)
8. itemNo (string): 货号 / SKU / 物料编号
9. unitPrice2 (number): 单价2 / 备用单价 / 含税单价 (数值)
10. supplier (string): 供应商名称

务必保证返回的是包含这些字段的JSON列表。如果某项缺失，填入合理的默认值 (数字填0，文本填空字符串)。`;

    const contents: any[] = [];
    if (text) {
      contents.push({ text: `进货单原始数据:\n${text}\n\n${prompt}` });
    }
    if (imageBase64) {
      contents.push({
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: imageBase64,
        },
      });
      contents.push({ text: prompt });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              seq: { type: Type.INTEGER },
              name: { type: Type.STRING },
              chineseName: { type: Type.STRING },
              unitPrice: { type: Type.NUMBER },
              discountPrice: { type: Type.NUMBER },
              barcode: { type: Type.STRING },
              expectedQty: { type: Type.INTEGER },
              itemNo: { type: Type.STRING },
              unitPrice2: { type: Type.NUMBER },
              supplier: { type: Type.STRING },
            },
            required: ['name', 'expectedQty'],
          },
        },
      },
    });

    const parsedJson = JSON.parse(response.text || '[]');
    return res.json({ items: parsedJson });
  } catch (error: any) {
    console.error('Invoice parsing error:', error);
    return res.status(500).json({ error: error?.message || '智能解析失败，请检查输入或格式' });
  }
});

import { mountImsRoutes } from './src/imsApp';
import { closeAllMssqlPools } from './src/core/db/pool';

mountImsRoutes(app);

// Production or Vite development middleware setup
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const server = app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT} (isProd=${isProd})`);
  });

  const shutdown = async () => {
    await closeAllMssqlPools();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer();
