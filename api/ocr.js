// Vercel Serverless Function
// Keeps GEMINI_API_KEY on the server. Never put it in index.html.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  try {
    const {images, names=[], defaultRate=0} = req.body || {};
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({error:'GEMINI_API_KEY is not configured on the server.'});
    if (!Array.isArray(images) || images.length === 0) return res.status(400).json({error:'No images received.'});
    if (images.length > 12) return res.status(400).json({error:'Maximum 12 images per request.'});

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const master = Array.isArray(names) ? names.filter(Boolean).slice(0,500) : [];
    const prompt = `
You are a careful OCR/data extraction assistant for handwritten Pakistani cotton purchase records.
Read ALL supplied notebook images. The handwriting may be Urdu, Roman Urdu, or mixed.
Return ONLY valid JSON in this exact shape:
{"records":[{"name":"...","weight":0}]}

Rules:
1. Extract every visible record row. Do not invent rows.
2. Weight must be numeric kilograms. Convert Urdu/Arabic digits to normal numbers.
3. A row may have a leading code such as 0-36; ignore the code unless it is clearly part of the person's name.
4. Names are the handwritten Urdu names, not the numbers.
5. Use this Name Master as a strong reference for spelling and matching:
${JSON.stringify(master)}
6. If handwriting is unclear, choose the closest Name Master entry ONLY when reasonably supported; otherwise preserve the best readable spelling.
7. Do not return explanations, markdown, or code fences.
8. The default rate is ${Number(defaultRate)||0}; do not include rate in output.
`;

    const parts = [{text:prompt}];
    for (const img of images) {
      if (!img || !img.data) continue;
      const mimeType = String(img.mimeType||'image/jpeg').startsWith('image/') ? img.mimeType : 'image/jpeg';
      parts.push({inline_data:{mime_type:mimeType,data:img.data}});
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
    const r = await fetch(endpoint, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        contents:[{parts}],
        generationConfig:{temperature:0,responseMimeType:'application/json'}
      })
    });
    const raw = await r.text();
    let data; try { data=JSON.parse(raw); } catch { data={}; }
    if (!r.ok) return res.status(r.status).json({error:data?.error?.message || `Gemini request failed (${r.status})`});

    const text = data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('') || '';
    let parsed; try { parsed=JSON.parse(text); } catch {
      const m=text.match(/\{[\s\S]*\}/); if(!m) throw new Error('AI returned invalid JSON.'); parsed=JSON.parse(m[0]);
    }
    const records=Array.isArray(parsed.records)?parsed.records.map(x=>({
      name:String(x.name||'').trim(),
      weight:Number(x.weight)
    })).filter(x=>x.name && Number.isFinite(x.weight) && x.weight>=0):[];
    return res.status(200).json({records});
  } catch(e) {
    return res.status(500).json({error:e.message || 'Server error'});
  }
}
