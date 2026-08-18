// api/ocr.js

export default async function handler(req, res) {
  /*
    Cotton Record OCR API

    Important:
    - Gemini API key server-side environment variable mein rahegi.
    - User ko Gemini/API technical errors nahi dikhaye jayenge.
    - Technical errors Vercel logs mein rahenge.
  */

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "PROCESSING_FAILED"
    });
  }

  try {
    const {
      images,
      names = [],
      defaultRate = 0
    } = req.body || {};

    // =========================================================
    // API KEY
    // =========================================================

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error("GEMINI_API_KEY is missing.");
      return res.status(500).json({
        error: "PROCESSING_FAILED"
      });
    }

    // =========================================================
    // IMAGE VALIDATION
    // =========================================================

    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({
        error: "PROCESSING_FAILED"
      });
    }

    // Free/basic limit
    // Premium limit can later be controlled server-side.
    if (images.length > 12) {
      console.error("Too many images:", images.length);

      return res.status(400).json({
        error: "PROCESSING_FAILED"
      });
    }

    // =========================================================
    // NAME MASTER
    // =========================================================

    const master = Array.isArray(names)
      ? names
          .filter(
            name =>
              typeof name === "string" &&
              name.trim().length > 0
          )
          .map(name => name.trim())
          .filter(Boolean)
          .slice(0, 500)
      : [];

    // =========================================================
    // DEFAULT RATE
    // =========================================================

    const safeDefaultRate =
      Number.isFinite(Number(defaultRate))
        ? Number(defaultRate)
        : 0;

    // =========================================================
    // OCR PROMPT
    // =========================================================

    const prompt = `
You are an extremely careful OCR and data-extraction assistant for handwritten Pakistani cotton purchase records.

Your task is to read ALL supplied notebook/slip images and extract ONLY the actual cotton records visible in the images.

The records may contain:

- Urdu handwriting
- Roman Urdu
- English
- Urdu/Arabic digits
- English digits
- Mixed Urdu and numbers
- Different handwriting styles
- Crossed or lightly written text
- Multiple records on one image
- Multiple people across multiple images

IMPORTANT:
Accuracy is more important than guessing.

RETURN ONLY VALID JSON.

Required format:

{
  "records": [
    {
      "name": "Person Name",
      "weight": 25
    }
  ]
}

=========================================================
IMPORTANT EXTRACTION RULES
=========================================================

1. Read every supplied image carefully.

2. Extract every clearly visible cotton record.

3. DO NOT invent a record.

4. DO NOT create a record simply because a name exists in Name Master.

5. A person should be returned only when a corresponding record is actually visible in an image.

6. Separate the person's name from the cotton weight.

7. Weight must be returned as a NUMBER in kilograms.

8. Do not include "kg", "K.G", "کلو", or other units inside the weight value.

9. Convert Urdu/Arabic/Persian digits into normal English numbers.

Examples:

۰ = 0
۱ = 1
۲ = 2
۳ = 3
۴ = 4
۵ = 5
۶ = 6
۷ = 7
۸ = 8
۹ = 9

Examples:

۱۲ = 12
۲۵ = 25
۳۶ = 36
۱۲.۵ = 12.5
۲۵.۵ = 25.5

10. Recognize decimal values carefully.

For example:

12.5 = 12.5 kg

11. Do not confuse record numbers with weights.

For example:

0-36

may mean a serial/code/reference and should NOT automatically become:

weight = 36

unless the image clearly indicates that 36 is the cotton weight.

12. Ignore dates, phone numbers, prices, serial numbers, account numbers and unrelated numbers unless clearly identified as cotton weight.

13. If a row contains a person's name and a clearly associated weight, extract it.

14. If a name is readable but its weight is not readable, DO NOT guess a weight.

15. If the weight is clearly readable but the name is unclear, use the best readable name only if there is enough evidence.

16. Do not create multiple records from one row unless the image clearly contains multiple separate people/weights.

17. Do not duplicate the same visible record.

18. If the same person appears in different images, KEEP EACH ACTUAL VISIBLE RECORD as a separate record.

The frontend will combine records with the same name later.

=========================================================
NAME MASTER
=========================================================

The following names were supplied by the user:

${JSON.stringify(master)}

Use Name Master only as a spelling/matching reference.

If the handwriting appears to refer to a Name Master entry, prefer the exact Name Master spelling.

However:

DO NOT create a record just because the name exists in Name Master.

The image itself must contain the actual record.

=========================================================
NAME MATCHING
=========================================================

When matching handwritten names:

- Ignore minor spelling differences.
- Ignore differences caused by Urdu/Roman Urdu writing.
- Prefer the closest Name Master spelling when confidence is high.
- Do not force a match when the handwriting clearly represents another person.
- Never replace a clearly different person's name with a random Name Master name.

=========================================================
MULTIPLE IMAGES
=========================================================

Process ALL images.

Do not stop after the first image.

Do not assume that all images contain the same people.

Each image can contain different records.

Check every image independently and then return one combined records array.

=========================================================
QUALITY CONTROL
=========================================================

Before returning JSON, internally verify:

- Every record has a name.
- Every record has a numeric weight.
- Weight is >= 0.
- No obvious duplicate caused by OCR repetition.
- No invented records.
- No explanations.
- No markdown.
- No code fences.

=========================================================
OUTPUT
=========================================================

Return ONLY JSON.

Do not return:

- explanations
- comments
- markdown
- ```json
- confidence scores
- OCR text
- rate
- payment

Only return:

{
  "records": [
    {
      "name": "...",
      "weight": 0
    }
  ]
}

Default rate supplied by frontend:

${safeDefaultRate}

DO NOT include the rate in the JSON response.
`;

    // =========================================================
    // IMAGE PARTS
    // =========================================================

    const parts = [
      {
        text: prompt
      }
    ];

    let validImageCount = 0;

    for (const image of images) {
      if (!image || !image.data) {
        continue;
      }

      const mime = String(
        image.mimeType || "image/jpeg"
      ).toLowerCase();

      const allowedMimeTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp"
      ];

      const mimeType = allowedMimeTypes.includes(mime)
        ? mime
        : "image/jpeg";

      const base64Data = String(image.data).trim();

      if (!base64Data) {
        continue;
      }

      /*
        Basic protection against accidentally sending
        extremely large image payloads.
      */

      if (base64Data.length > 15_000_000) {
        console.error(
          "Image payload too large:",
          image.name || "unknown"
        );

        continue;
      }

      parts.push({
        inline_data: {
          mime_type: mimeType,
          data: base64Data
        }
      });

      validImageCount++;
    }

    if (validImageCount === 0) {
      return res.status(400).json({
        error: "PROCESSING_FAILED"
      });
    }

    // =========================================================
    // GEMINI MODEL
    // =========================================================

    /*
      Keep the model in one place so it can easily be changed later.
    */

    const model =
      process.env.GEMINI_MODEL ||
      "gemini-2.5-flash";

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // =========================================================
    // GEMINI REQUEST
    // =========================================================

    const response = await fetch(
      endpoint,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },

        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts
            }
          ],

          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const raw = await response.text();

    let data = {};

    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }

    // =========================================================
    // GEMINI ERROR
    // =========================================================

    if (!response.ok) {
      console.error(
        "Gemini API error:",
        response.status,
        data?.error?.message || raw
      );

      return res.status(500).json({
        error: "PROCESSING_FAILED"
      });
    }

    // =========================================================
    // EXTRACT GEMINI TEXT
    // =========================================================

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part?.text || "")
        .join("")
        .trim() || "";

    if (!text) {
      console.error(
        "Gemini returned empty OCR response."
      );

      return res.status(500).json({
        error: "PROCESSING_FAILED"
      });
    }

    // =========================================================
    // PARSE JSON
    // =========================================================

    let parsed = null;

    try {
      parsed = JSON.parse(text);
    } catch {
      /*
        Sometimes a model may return extra characters.
        Try to recover the JSON object.
      */

      const match = text.match(
        /\{[\s\S]*\}/
      );

      if (!match) {
        console.error(
          "Gemini returned invalid JSON:",
          text
        );

        return res.status(500).json({
          error: "PROCESSING_FAILED"
        });
      }

      try {
        parsed = JSON.parse(match[0]);
      } catch (error) {
        console.error(
          "Recovered JSON could not be parsed:",
          error
        );

        return res.status(500).json({
          error: "PROCESSING_FAILED"
        });
      }
    }

    // =========================================================
    // CLEAN NAME
    // =========================================================

    function cleanName(value) {
      if (
        value === null ||
        value === undefined
      ) {
        return "";
      }

      return String(value)
        .replace(/\s+/g, " ")
        .trim();
    }

    // =========================================================
    // CONVERT DIGITS
    // =========================================================

    function normalizeDigits(value) {
      if (
        value === null ||
        value === undefined
      ) {
        return "";
      }

      return String(value)
        .replace(/[۰-۹]/g, d =>
          String(
            "۰۱۲۳۴۵۶۷۸۹".indexOf(d)
          )
        )
        .replace(/[٠-٩]/g, d =>
          String(
            "٠١٢٣٤٥٦٧٨٩".indexOf(d)
          )
        )
        .replace(/٫/g, ".")
        .replace(/،/g, ",");
    }

    // =========================================================
    // CLEAN WEIGHT
    // =========================================================

    function cleanWeight(value) {
      const normalized =
        normalizeDigits(value)
          .replace(/,/g, "")
          .trim();

      if (!normalized) {
        return NaN;
      }

      const number =
        Number(normalized);

      if (!Number.isFinite(number)) {
        return NaN;
      }

      if (number < 0) {
        return NaN;
      }

      /*
        Prevent clearly abnormal OCR values from
        being accidentally accepted.
      */

      if (number > 100000) {
        return NaN;
      }

      return number;
    }

    // =========================================================
    // CLEAN RECORDS
    // =========================================================

    const rawRecords =
      Array.isArray(parsed?.records)
        ? parsed.records
        : [];

    const cleanedRecords = [];

    for (const item of rawRecords) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const name =
        cleanName(item.name);

      const weight =
        cleanWeight(item.weight);

      if (!name) {
        continue;
      }

      if (!Number.isFinite(weight)) {
        continue;
      }

      cleanedRecords.push({
        name,
        weight
      });
    }

    // =========================================================
    // REMOVE EXACT DUPLICATES
    // =========================================================

    const seen = new Set();

    const records =
      cleanedRecords.filter(item => {
        const key =
          `${item.name.toLowerCase()}|${item.weight}`;

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });

    // =========================================================
    // SUCCESS
    // =========================================================

    console.log(
      `OCR successful: ${validImageCount} image(s), ${records.length} record(s)`
    );

    return res.status(200).json({
      records
    });

  } catch (error) {
    /*
      NEVER expose technical error details to the user.
      Full error stays in Vercel logs.
    */

    console.error(
      "OCR SERVER ERROR:",
      error
    );

    return res.status(500).json({
      error: "PROCESSING_FAILED"
    });
  }
    }
