// api/ocr.js

export default async function handler(req, res) {
  /*
    User ko Gemini/API technical error details nahi dikhani.
    Technical details sirf Vercel logs mein jayengi.
  */

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "PROCESSING_FAILED"
    });
  }

  try {
    // =========================================================
    // REQUEST DATA
    // =========================================================

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
      console.error(
        "GEMINI_API_KEY is missing."
      );

      return res.status(500).json({
        error: "PROCESSING_FAILED"
      });
    }

    // =========================================================
    // IMAGES VALIDATION
    // =========================================================

    if (
      !Array.isArray(images) ||
      images.length === 0
    ) {
      return res.status(400).json({
        error: "PROCESSING_FAILED"
      });
    }

    if (images.length > 12) {
      return res.status(400).json({
        error: "PROCESSING_FAILED"
      });
    }

    // =========================================================
    // MODEL
    // =========================================================

    const model = "gemini-3.6-flash";

    // =========================================================
    // NAME MASTER
    // =========================================================

    const master = Array.isArray(names)
      ? names
          .filter(
            name =>
              typeof name === "string" &&
              name.trim()
          )
          .map(name => name.trim())
          .slice(0, 500)
      : [];

    // =========================================================
    // PROMPT
    // =========================================================

    const prompt = `
You are a highly accurate OCR and data extraction assistant
for handwritten Pakistani cotton purchase records.

Read ALL supplied notebook images carefully.

The handwriting may contain:

- Urdu
- Roman Urdu
- Arabic/Urdu digits
- English digits
- Mixed Urdu and numbers

Extract every clearly visible cotton purchase record.

Return ONLY valid JSON in exactly this format:

{"records":[{"name":"...","weight":0}]}

Rules:

1. Extract every clearly visible record row.

2. Do not invent records.

3. Do not skip clearly readable records.

4. Weight must be numeric kilograms.

5. Convert Urdu/Arabic digits into normal English numbers.

6. Examples:

۱۲.۵ = 12.5
۲۵ = 25
۳۶ = 36

7. Convert Arabic decimal separator "٫" to "." when necessary.

8. Ignore leading record codes such as 0-36 or 1-25
   unless they are clearly part of the person's name.

9. Separate the person's name from the weight.

10. Use the Name Master to improve spelling and matching.

11. Only use a Name Master name when the actual image
    contains a matching record.

12. Never create a record merely because a name exists
    in the Name Master.

13. If a record is unclear, do not invent its value.

14. Weight must be zero or greater.

15. Do not include rate in the JSON.

16. Do not return explanations.

17. Do not return markdown.

18. Return JSON only.

Name Master:
${JSON.stringify(master)}

Default rate:
${Number(defaultRate) || 0}
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
      if (
        !image ||
        typeof image.data !== "string" ||
        !image.data.trim()
      ) {
        continue;
      }

      const mime = String(
        image.mimeType || "image/jpeg"
      );

      const mimeType = mime.startsWith("image/")
        ? mime
        : "image/jpeg";

      parts.push({
        inline_data: {
          mime_type: mimeType,
          data: image.data
        }
      });

      validImageCount++;
    }

    // =========================================================
    // VALID IMAGE CHECK
    // =========================================================

    if (validImageCount === 0) {
      console.error(
        "No valid images were supplied."
      );

      return res.status(400).json({
        error: "PROCESSING_FAILED"
      });
    }

    // =========================================================
    // GEMINI ENDPOINT
    // =========================================================

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

    // =========================================================
    // READ RESPONSE
    // =========================================================

    const raw = await response.text();

    let data = {};

    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }

    // =========================================================
    // HIDE GEMINI ERROR
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
        Fallback:
        Agar model ne JSON ke around extra characters
        return kiye hon.
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
    // NORMALIZE DIGITS
    // =========================================================

    function normalizeDigits(value) {
      if (
        value === null ||
        value === undefined
      ) {
        return "";
      }

      return String(value)
        // Urdu digits
        .replace(/[۰-۹]/g, d =>
          String(
            "۰۱۲۳۴۵۶۷۸۹".indexOf(d)
          )
        )

        // Arabic digits
        .replace(/[٠-٩]/g, d =>
          String(
            "٠١٢٣٤٥٦٧٨٩".indexOf(d)
          )
        )

        // Arabic decimal separator
        .replace(/٫/g, ".")

        // Arabic comma
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

      const number = Number(normalized);

      if (!Number.isFinite(number)) {
        return NaN;
      }

      if (number < 0) {
        return NaN;
      }

      /*
        Prevent obviously abnormal OCR values.
      */

      if (number > 100000) {
        return NaN;
      }

      return number;
    }

    // =========================================================
    // RAW RECORDS
    // =========================================================

    const rawRecords =
      Array.isArray(parsed?.records)
        ? parsed.records
        : [];

    // =========================================================
    // CLEAN RECORDS
    // =========================================================

    const records = [];

    for (const item of rawRecords) {
      if (
        !item ||
        typeof item !== "object"
      ) {
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

      records.push({
        name,
        weight
      });
    }

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
       }Records = [];

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
